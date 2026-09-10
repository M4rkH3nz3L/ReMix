import type { VideoClip } from '@/types/project';

/**
 * Smart Search (P0‑8) — pure segédek: keyframe-időpont választás, forrás→
 * idővonal leképezés és kulcsszó-fallback pontozás (expo-mentes, tesztelhető).
 */

export interface VisionEntry {
  /** forrás-idő (mp) */
  t: number;
  description: string;
  labels: string[];
}

export interface SearchHit {
  /** idővonal-idő (mp) */
  time: number;
  uri: string;
  description: string;
  labels: string[];
  score: number;
  /** honnan jött a találat (hiányzó = vision — a régi hívók miatt) */
  source?: 'vision' | 'transcript';
}

/** címkézendő időpontok: jelenet-kezdetek után 0,5-tel; ritka jelenetnél 3 mp-enként */
export function pickKeyframeTimes(
  duration: number,
  scenes: number[],
  cap = 10
): number[] {
  const times: number[] = [0.5];
  for (const s of scenes) {
    if (s + 0.5 < duration) {
      times.push(Math.round((s + 0.5) * 10) / 10);
    }
  }
  if (times.length < 3) {
    for (let t = 3; t < duration; t += 3) {
      times.push(t);
    }
  }
  const unique = times
    .filter((t, i, arr) => arr.findIndex((o) => Math.abs(o - t) < 0.8) === i)
    .sort((a, b) => a - b);
  if (unique.length <= cap) {
    return unique;
  }
  // egyenletes ritkítás a cap-re
  const step = unique.length / cap;
  return Array.from({ length: cap }, (_, i) => unique[Math.floor(i * step)]);
}

/** a bejegyzések idővonalra képezve a klipek látható ablakain át */
export function entriesToTimeline(
  clips: VideoClip[],
  entriesByUri: Map<string, VisionEntry[]>
): Omit<SearchHit, 'score'>[] {
  const out: Omit<SearchHit, 'score'>[] = [];
  for (const clip of clips) {
    const entries = entriesByUri.get(clip.uri) ?? [];
    const winStart = clip.trimIn;
    const winEnd = clip.trimIn + clip.duration * clip.speed;
    for (const e of entries) {
      if (e.t < winStart || e.t >= winEnd) {
        continue;
      }
      out.push({
        time: clip.start + (e.t - winStart) / clip.speed,
        uri: clip.uri,
        description: e.description,
        labels: e.labels,
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** kisbetű + ékezet-levágás a magyar kereséshez */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** kulcsszó-fallback: a lekérdezés tokenjeinek fedése a dokumentumban (0–1) */
export function keywordScore(query: string, doc: string): number {
  const tokens = normalizeText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) {
    return 0;
  }
  const hay = normalizeText(doc);
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}
