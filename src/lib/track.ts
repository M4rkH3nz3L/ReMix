import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

/**
 * Követés-kliens (P0‑6): a worker /track végpontja a megadott vászon-pontot
 * követi a videó egy szakaszán (NCC-tracker) — az eredményből a szöveg/matrica
 * pozíció-kulcskockái épülnek (delta-mozgás az induló pozícióhoz képest).
 */

import type { TrackPoint } from '@/lib/trackPlan';

export { pointsToPositionKeyframes } from '@/lib/trackPlan';
export type { TrackPoint };

export async function trackSubject(
  uri: string,
  opts: {
    startSec: number;
    durationSec: number;
    cx: number;
    cy: number;
    aspectW: number;
    aspectH: number;
  }
): Promise<TrackPoint[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const base = renderServerUrl();
  try {
    await fetch(`${base}/health`);
  } catch {
    return null;
  }
  try {
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    form.append('startSec', String(opts.startSec));
    form.append('durationSec', String(opts.durationSec));
    form.append('cx', String(opts.cx));
    form.append('cy', String(opts.cy));
    form.append('aspectW', String(opts.aspectW));
    form.append('aspectH', String(opts.aspectH));
    const res = await uploadFetch(`${base}/track`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { points: TrackPoint[] };
    return Array.isArray(body.points) && body.points.length >= 2 ? body.points : null;
  } catch {
    return null;
  }
}
