import { Platform } from 'react-native';

import { mapSourceRangesToTimeline } from '@/lib/autoedit';
import { ensureCloud } from '@/lib/backend';
import { detectSilence } from '@/lib/cutlist';
import type { SilenceRange } from '@/lib/cutlist';
import type { Project, VideoClip } from '@/types/project';

/**
 * 🎞️ B-roll-hely kereső (Phase 4.4 / saját média): a beszéd-SZÜNETEK (csend-
 * sávok) azok a pontok, ahol a talking-head monoton — ott a legjobb SAJÁT B-roll
 * felvétellel takarni. A `cutDeadAir` jelének inverz, kreatív használata: vágás
 * helyett TAKARÁS. Nem módosít — csak megmutatja, hova érdemes B-rollt tenni.
 *
 * Pro (a csend-detektálás worker-jel). Best-effort: web / worker nélkül null.
 */

/** ennél rövidebb szünetnél nem érdemes B-rollt vágni (mp) */
const MIN_SPOT = 1.5;

export interface BrollSpot {
  start: number;
  end: number;
}

export async function findBrollSpots(project: Project): Promise<BrollSpot[] | null> {
  ensureCloud('autoEdit'); // Pro-kapu (AI/worker-jel)
  if (Platform.OS === 'web') {
    return null;
  }
  const videoClips = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  if (videoClips.length === 0) {
    return null;
  }

  const silencesByUri = new Map<string, SilenceRange[]>();
  for (const uri of [...new Set(videoClips.map((c) => c.uri))]) {
    const sil = await detectSilence(uri);
    if (sil) {
      silencesByUri.set(uri, sil);
    }
  }
  const spots = mapSourceRangesToTimeline(videoClips, silencesByUri)
    .filter((r) => r.end - r.start >= MIN_SPOT)
    .map((r) => ({ start: Math.round(r.start * 100) / 100, end: Math.round(r.end * 100) / 100 }));

  return spots.length > 0 ? spots : null;
}
