import { File } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import {
  needsReframe,
  pathToReframeKeyframes,
  sourceWindow,
} from '@/lib/reframe';
import { uploadFetch } from '@/lib/upload';
import type { ReframePoint } from '@/lib/reframe';
import { ensureCloud } from '@/lib/backend';
import { finiteNum, finiteTime, mapValid, unitNum } from '@/lib/parseGuards';
import type { ProgressUpdate } from '@/lib/progress';
import type { Clip, Project } from '@/types/project';

/**
 * Auto Reframe hálózati rétege (P0‑7): klipenként lekéri a téma-útvonalat a
 * workertől, és a pure reframe.ts-sel cover+pan kulcskockákká fordítja.
 */

interface ReframeReply {
  width: number;
  height: number;
  points: ReframePoint[];
}

async function analyzeClipReframe(
  uri: string,
  startSec: number,
  durationSec: number
): Promise<ReframeReply | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const base = ensureCloud('reframe');
  try {
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    form.append('startSec', String(startSec));
    form.append('durationSec', String(durationSec));
    const res = await uploadFetch(`${base}/reframe`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { width?: unknown; height?: unknown; points?: unknown };
    const width = finiteNum(body.width);
    const height = finiteNum(body.height);
    if (width === null || height === null || width <= 0 || height <= 0) {
      return null; // a méret osztóként szerepel a kulcskocka-számításban
    }
    // 🛡️ az x/y normalizált középpont → pan-kulcskocka: a 0–1-en kívüli érték
    // a vásznon kívülre vinné a képet, a NaN pedig „eltüntetné" a klipet
    const points = mapValid<ReframePoint>(body.points, (p) => {
      const t = finiteTime(p.t);
      const x = unitNum(p.x);
      const y = unitNum(p.y);
      return t === null || x === null || y === null ? null : { t, x, y };
    });
    return points.length > 0 ? { width, height, points } : null;
  } catch {
    return null;
  }
}

export interface SmartReframePlan {
  clips: Clip[];
  /** hány klip kapott téma-követő kitöltést */
  changed: number;
}

/**
 * Okos-kitöltés terv a teljes videósávra: az arány-eltérő videóklipek
 * cover-scale + téma-követő pan kulcskockákat kapnak. Null, ha nincs teendő
 * vagy a worker nem érhető el.
 */
export async function buildSmartReframe(
  project: Project,
  canvasAspect: number,
  onProgress?: (u: ProgressUpdate) => void
): Promise<SmartReframePlan | null> {
  const track = project.tracks.find((t) => t.type === 'video');
  if (!track || track.clips.length === 0) {
    return null;
  }
  const out: Clip[] = [];
  let changed = 0;
  const videoClips = track.clips.filter((c) => c.kind === 'video');
  let i = 0;
  for (const clip of track.clips) {
    if (clip.kind !== 'video') {
      out.push(clip);
      continue;
    }
    i++;
    onProgress?.({
      phase: tr('lib.reframeClient.phaseSubjectAnalysis'),
      current: i,
      total: videoClips.length,
      unit: tr('lib.reframeClient.unitClip'),
    });
    const win = sourceWindow(clip);
    const reply = await analyzeClipReframe(clip.uri, win.startSec, win.durationSec);
    if (!reply) {
      out.push(clip);
      continue;
    }
    const srcAspect = reply.width / reply.height;
    if (!needsReframe(srcAspect, canvasAspect)) {
      out.push(clip);
      continue;
    }
    const keyframes = pathToReframeKeyframes(
      reply.points,
      srcAspect,
      canvasAspect,
      clip.speed
    );
    // a reframe átveszi a keretezést: korábbi transform/kitöltés törlődik
    out.push({ ...clip, keyframes, transform: undefined, backgroundFill: undefined });
    changed++;
  }
  return changed > 0 ? { clips: out, changed } : null;
}
