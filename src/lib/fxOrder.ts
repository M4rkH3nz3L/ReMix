/**
 * 🔀 A klip effektláncának szerkeszthető sorrendje — tiszta mag (a telefonos DSP és a szerveres render
 * ugyanezt követi: `server/voicechain.js` `fxStageOrder` — szerződés-teszt köti össze).
 *
 * Mozgatható fokozatok: szűrők (alul-/felüláteresztő), EQ, kapu, de-esser, kompresszor, zengés,
 * visszhang, sztereó-szélesítés. Rögzített: elöl a visszhang-csökkentés / hangmagasság / zajszűrés,
 * hátul a normalizálás és a limiter (a csúcsplafon mindig az utolsó).
 */
export const FX_STAGES = ['filters', 'eq', 'gate', 'deEsser', 'compressor', 'reverb', 'delay', 'stereoWide'] as const;
export type FxStage = (typeof FX_STAGES)[number];

/** a tényleges sorrend: a megadott (érvényes, egyedi) fokozatok, utána a hiányzók az alap helyükön */
export function fxStageOrder(order: readonly string[] | undefined): FxStage[] {
  const out: FxStage[] = [];
  for (const s of order ?? []) {
    if ((FX_STAGES as readonly string[]).includes(s) && !out.includes(s as FxStage)) out.push(s as FxStage);
  }
  for (const s of FX_STAGES) if (!out.includes(s)) out.push(s);
  return out;
}

/** egy fokozat feljebb/lejjebb léptetése (a felület gombjai) */
export function moveStage(order: readonly string[] | undefined, stage: FxStage, dir: -1 | 1): FxStage[] {
  const cur = fxStageOrder(order);
  const i = cur.indexOf(stage);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  const next = [...cur];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** az alap sorrend-e (ilyenkor a mező elhagyható) */
export function isDefaultOrder(order: readonly string[] | undefined): boolean {
  return fxStageOrder(order).every((s, i) => s === FX_STAGES[i]);
}
