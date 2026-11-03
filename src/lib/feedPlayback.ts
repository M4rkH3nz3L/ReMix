/**
 * ▶️ Feed-lejátszás segédei — pure, expo-mentes (a `useFeed` hook és a feed-vezérlők használják).
 *
 *  • `formatPlayClock` — lejátszási óra a tekerő-csík mellé („0:07", „12:30", „1:02:05");
 *  • `toVolumeStep` — a csúszka-arányt EGÉSZ százalékra kerekíti (0–100 lépcső), hogy a
 *    kijelzett szám és a lejátszó hangereje mindig egyezzen.
 */

/** mp → „m:ss", egy óra fölött „h:mm:ss"; érvénytelen / negatív bemenet → „0:00". */
export function formatPlayClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** csúszka-arány (bármi) → hangerő 0–1, egész százalékra kerekítve (0, 0.01 … 1). */
export function toVolumeStep(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100) / 100;
}
