import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

/**
 * 🏆 Best-shot kliens (P0‑1): a worker /shotscore végpontja forrás-időpontok
 * vizuális minőségét adja (élesség + kontraszt + arc-bónusz) — az Auto Edit
 * ebből tudja, melyik pillanat néz ki jól.
 */

export interface ShotScore {
  /** forrás-mp */
  t: number;
  score: number;
  /** átlag-fényerő 0–1 (expozíció-elemzéshez); régi worker válaszban hiányozhat */
  luma?: number;
  faces: number;
}

export async function fetchShotScores(
  uri: string,
  times: number[]
): Promise<ShotScore[] | null> {
  if (Platform.OS === 'web' || times.length === 0) {
    return null;
  }
  try {
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    form.append('times', JSON.stringify(times.slice(0, 24)));
    const res = await uploadFetch(`${renderServerUrl()}/shotscore`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { shots: ShotScore[] };
    return Array.isArray(body.shots) && body.shots.length > 0 ? body.shots : null;
  } catch {
    return null;
  }
}
