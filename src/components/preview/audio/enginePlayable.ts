import { canSegment, isLongSource } from '@/lib/longSource';
import { needsWholeWindow, type OfflineMixPlan } from '@/lib/offlineMix';

/**
 * 🎧 A motor játszhatja-e a projektet: amit a közös keverő (= az export) tud, helyi forrásokból;
 * a hosszú forrás szakaszosan (`longSource`). Különben a klipenkénti lejátszók szólnak.
 */
export function engineCanPlay(plan: OfflineMixPlan | null): boolean {
  return !plan || (plan.unsupported.length === 0 && plan.clips.every((c) => c.uri.startsWith('file:') && longClipPlayable(c)));
}

/**
 * 🎧 a hosszú (10 percnél hosszabb) forrás szakaszosan szól — ha a build tud szakaszosan
 * dekódolni, és a klip nem kér egész-ablakos feldolgozást (azt a telefon hosszú forráson nem
 * bírná: a 60 perces zajszűrés ~27 perc volna)
 */
export function longClipPlayable(c: OfflineMixPlan['clips'][number]): boolean {
  if (!isLongSource(c.sourceDuration)) {
    return true;
  }
  return canSegment() && !needsWholeWindow(c);
}
