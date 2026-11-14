/**
 * 🎧 V13: az előnézeti motor előpuffere a keverés költségéhez igazítva (expo-mentes, tiszta mag).
 *
 * Mérve (iPad M1, 8 sáv effektekkel): egy 125 ms-os szelet keverése ~21 ms; 0,75 s előpufferrel
 * az indításkori felületi munka 5 hidegindításból egyszer 3 szeletnyi késést adott (750 ms-nál).
 * A drága keverésnél (szeletenként > `HEAVY_CHUNK_MS`) 1,5 s-ot keverünk előre — a könnyű projekt
 * (1–3 sáv, ~2–5 ms) marad a 0,75 s-on.
 */

export const AHEAD_SEC = 0.75;
export const HEAVY_AHEAD_SEC = 1.5;
/** ennél drágább szeletkeverés (ms / 125 ms hang ≈ 10% valós idő) már „nehéz” projekt */
export const HEAVY_CHUNK_MS = 12;

/** a költség-becslés: a csúcs azonnal érvényes, lassan (szeletenként 5%) felejt */
export function nextChunkCost(prevMs: number, mixMs: number): number {
  return Math.max(mixMs, prevMs * 0.95);
}

export function aheadSecFor(costMs: number): number {
  return costMs > HEAVY_CHUNK_MS ? HEAVY_AHEAD_SEC : AHEAD_SEC;
}
