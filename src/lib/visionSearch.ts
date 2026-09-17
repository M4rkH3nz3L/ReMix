import { File } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import { detectScenes } from '@/lib/cutlist';
import { renderServerUrl } from '@/lib/render';
import type { ProgressUpdate } from '@/lib/progress';
import {
  entriesToTimeline,
  keywordScore,
  pickKeyframeTimes,
} from '@/lib/visionIndex';
import type { SearchHit, VisionEntry } from '@/lib/visionIndex';
import type { Project, VideoClip } from '@/types/project';
import { ANALYSIS_CACHE_LIMIT, LruCache } from '@/lib/lruCache';

/**
 * Smart Search hálózati rétege (P0‑8): a projekt videóinak jelenet-keyframe-jei
 * a worker vision-modelljével címkéződnek (fájlonként cache), a keresés
 * embedding-hasonlósággal fut (nomic-embed), kulcsszó-fallbackkel.
 */

const indexCache = new LruCache<VisionEntry[]>(ANALYSIS_CACHE_LIMIT);

/** 🧹 a vision-index ürítése (a `cacheManager.clearCaches()` hívja) */
export function clearVisionMemory(): void {
  indexCache.clear();
}

async function indexUri(
  uri: string,
  sourceDuration: number,
  scenes: number[]
): Promise<VisionEntry[] | null> {
  const cached = indexCache.get(uri);
  if (cached) {
    return cached;
  }
  const base = renderServerUrl();
  try {
    const times = pickKeyframeTimes(sourceDuration, scenes);
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    form.append('times', JSON.stringify(times));
    const res = await uploadFetch(`${base}/vision/index`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { entries: VisionEntry[] };
    if (!Array.isArray(body.entries)) {
      return null;
    }
    indexCache.set(uri, body.entries);
    return body.entries;
  } catch {
    return null;
  }
}

/** A projekt vizuális indexe idővonal-időre képezve (best-effort). */
export async function indexProjectVision(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void
): Promise<Omit<SearchHit, 'score'>[]> {
  if (Platform.OS === 'web') {
    return [];
  }
  const videoClips = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  const uris = [...new Set(videoClips.map((c) => c.uri))];
  const entriesByUri = new Map<string, VisionEntry[]>();
  for (let i = 0; i < uris.length; i++) {
    onProgress?.({
      phase: tr('lib.visionSearch.phaseVisualIndex'),
      current: i + 1,
      total: uris.length,
      unit: tr('lib.visionSearch.unitVideo'),
    });
    const uri = uris[i];
    const clip = videoClips.find((c) => c.uri === uri)!;
    const scenes = (await detectScenes(uri)) ?? [];
    const entries = await indexUri(uri, clip.sourceDuration, scenes);
    if (entries) {
      entriesByUri.set(uri, entries);
    }
  }
  return entriesToTimeline(videoClips, entriesByUri);
}

/** Keresés az indexben: embedding-pontozás a workeren, kulcsszó-fallback. */
export async function searchVision(
  query: string,
  index: Omit<SearchHit, 'score'>[]
): Promise<SearchHit[]> {
  if (index.length === 0) {
    return [];
  }
  const docs = index.map((e) => `${e.description} ${e.labels.join(' ')}`);
  let scores: number[] | null = null;
  try {
    const res = await uploadFetch(`${renderServerUrl()}/vision/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, docs }),
    });
    if (res.ok) {
      const body = (await res.json()) as { scores: number[] };
      if (Array.isArray(body.scores) && body.scores.length === docs.length) {
        scores = body.scores;
      }
    }
  } catch {
    // embedding nem érhető el — kulcsszó-fallback
  }
  // hibrid pontozás: az embedding magyar szövegen szűk dinamikájú (nomic),
  // a kulcsszó-fedés nyitja szét a releváns/irreleváns találatokat
  const minScore = scores ? 0.5 : 0.34;
  const hits = index
    .map((e, i) => {
      const kw = keywordScore(query, docs[i]);
      const score = scores ? 0.6 * scores[i] + 0.4 * kw : kw;
      return { ...e, score: Math.round(score * 1000) / 1000 };
    })
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return hits;
}
