import type { Clip } from '@/types/project';

/**
 * 🧩 Kötegelt szerkesztés (több-kijelölés) — pure réteg.
 *
 * Az elv: a panelek NEM tudnak a több-kijelölésről. Ha több klip van kijelölve,
 * az elsődleges klipre menő `updateClip` patch STÍLUS-jellegű mezői a többi
 * kijelölt klipre is rámennek — így minden meglévő panel (szűrő, fény, áttűnés,
 * szöveg-stílus, keverés…) külön munka nélkül működik kötegelve.
 *
 * Ezért kell szigorú ALLOWLIST: az idő- és geometria-mezőket (start, duration,
 * trimIn, position, w/h…) tilos másolni, mert azonos `start`-tal a klipek
 * egymásra csúsznának, azonos `position`-nel a szövegek egymásra kerülnének.
 * A per-klip mért adatokat (arc-régió, mélység) sem visszük át, mert azok
 * a KLIP SAJÁT képéből származnak, és másikon értelmetlenek lennének.
 */

/**
 * Ezek a mezők vihetők át a többi kijelölt klipre. Vászon-normalizált vagy
 * dimenziótlan értékek — másik klipen is ugyanazt jelentik.
 */
export const BATCHABLE_KEYS = new Set<string>([
  // kép-megjelenés
  'filterId',
  'filterIntensity',
  'adjust',
  'lighting',
  'backgroundFill',
  'opacity',
  'mask',
  'chromaKey',
  'tilt3d',
  'transform',
  'motionBlur',
  // idő-szélek (relatív hosszak, nem abszolút időpontok)
  'fadeInSec',
  'fadeOutSec',
  'fadeIn',
  'fadeOut',
  'transitionOut',
  // hang
  'volume',
  'voiceEnhance',
  'deReverb',
  'autoDuck',
  // szöveg-stílus
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'animation',
  'stylePreset',
  'text3d',
  // forma-stílus
  'shape',
  'fill',
  'fillGradient',
  'borderColor',
  'borderWidth',
  'cornerRadius',
  'shadow',
  'blendMode',
]);

/**
 * Amit SOSEM viszünk át, még ha véletlenül felkerülne a listára sem — a
 * dokumentáció és a védőháló egyben. Idő/geometria/identitás/per-klip mérés.
 */
export const NEVER_BATCH = new Set<string>([
  'id',
  'kind',
  'assetId',
  'uri',
  'imageUri',
  'start',
  'duration',
  'trimIn',
  'sourceDuration',
  'speed', // a sebesség a hosszat is átírja — a panel maga számolja
  'position',
  'w',
  'h',
  'rect',
  'points',
  'keyframes',
  'text',
  'label',
  'emphasis', // szó-INDEXEK — másik szövegen más szóra mutatna
  'faceBlur', // a klip saját képéből mért régió
  'selective',
  'depthParallax',
  'depthFocus',
  'source',
]);

/** A patch köteggel átvihető része (üresnél null — nincs mit tenni). */
export function batchablePatch(patch: Partial<Clip>): Partial<Clip> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (BATCHABLE_KEYS.has(key) && !NEVER_BATCH.has(key)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? (out as Partial<Clip>) : null;
}

/**
 * A patch alkalmazása a megadott klipekre. Csak az AZONOS FAJTÁJÚ klipek
 * kapják meg (egy szöveg-stílus nem való videóklipre) — a `kind` az elsődleges
 * klipé. A többi klip érintetlenül megy tovább, a sorrend nem változik.
 */
export function applyBatchPatch(
  clips: Clip[],
  ids: Set<string>,
  patch: Partial<Clip>,
  kind: Clip['kind']
): { clips: Clip[]; changed: number } {
  let changed = 0;
  const out = clips.map((c) => {
    if (!ids.has(c.id) || c.kind !== kind) {
      return c;
    }
    changed += 1;
    return { ...c, ...patch } as Clip;
  });
  return { clips: out, changed };
}

/**
 * 📋 Stílus kinyerése egy klipből (vágólapra). Csak a kötegelhető mezők —
 * ugyanaz a lista, mint a több-kijelölésnél, tehát idő/geometria/per-klip
 * mérés sosem kerül a vágólapra.
 */
export function extractStyle(clip: Clip): Partial<Clip> {
  const out: Record<string, unknown> = {};
  for (const key of BATCHABLE_KEYS) {
    if (key in clip) {
      out[key] = (clip as unknown as Record<string, unknown>)[key];
    }
  }
  return out as Partial<Clip>;
}

/**
 * A beillesztendő patch: a forrás stílusa, PLUSZ explicit `undefined` azokra a
 * mezőkre, amik a célon vannak, de a forráson nincsenek — így a beillesztés
 * tényleg „legyen ilyen", nem „vedd fel ezeket is". (Enélkül egy neon fényű
 * célklip megtartaná a fényét egy fény nélküli forrás beillesztésekor.)
 */
export function styleTransferPatch(
  style: Partial<Clip>,
  target: Clip
): Partial<Clip> {
  const out: Record<string, unknown> = { ...style };
  for (const key of BATCHABLE_KEYS) {
    if (key in target && !(key in style)) {
      out[key] = undefined;
    }
  }
  return out as Partial<Clip>;
}

/** rövid, emberi összefoglaló a vágólapon lévő stílusról */
export function describeStyle(style: Partial<Clip>): string {
  const s = style as Record<string, unknown>;
  const parts: string[] = [];
  if (s.filterId && s.filterId !== 'none') parts.push(`szűrő: ${String(s.filterId)}`);
  if (s.lighting) parts.push(`fény: ${String(s.lighting)}`);
  if (s.adjust) parts.push('képjavítás');
  if (s.mask) parts.push('maszk');
  if (s.chromaKey) parts.push('green screen');
  if (s.transitionOut) parts.push('áttűnés');
  if (s.stylePreset) parts.push(`stílus: ${String(s.stylePreset)}`);
  if (s.animation && s.animation !== 'none') parts.push(`animáció: ${String(s.animation)}`);
  if (s.color) parts.push(`szín: ${String(s.color)}`);
  if (s.motionBlur) parts.push('mozgás-elmosás');
  if (typeof s.volume === 'number') parts.push(`hangerő: ${Math.round(s.volume * 100)}%`);
  return parts.length > 0 ? parts.join(' · ') : 'alap megjelenés';
}

/**
 * A kötegelt duplikálás elhelyezése: a másolatok a kijelölés UTÁN, a saját
 * relatív távolságukat megtartva kerülnek le — így a ritmus nem borul fel.
 */
export function duplicateOffset(selected: Clip[]): number {
  if (selected.length === 0) {
    return 0;
  }
  const start = Math.min(...selected.map((c) => c.start));
  const end = Math.max(...selected.map((c) => c.start + c.duration));
  return end - start;
}
