import type {
  AdjustmentKind,
  AdjustmentLayer,
  ClipAdjust,
  CurvePoint,
  ClipLut,
  ToneCurves,
} from '@/types/project';
import { isIdentityCurve } from '@/lib/curves';
import { makeId } from '@/lib/id';

// a típusok a `types/project.ts`-ben élnek (a PhotoLayer.adjustmentStack mezőhöz) —
// innen re-exportáljuk a visszafelé-kompatibilitásért
export type { AdjustmentKind, AdjustmentLayer };

/**
 * 🎚️ Non-destruktív adjustment-stack (Creative Canvas / Photo) — pure réteg.
 *
 * A `PhotoLayer.adjust` MA egyetlen `ClipAdjust`-ot hordoz. Ez a mag EGY
 * SORRENDEZETT, KI/BE-KAPCSOLHATÓ, SÚLYOZOTT korrekciós-verem (Photoshop-szerű
 * adjustment layers) az igazság-forrása, amit renderhez a MEGLÉVŐ egyetlen
 * `ClipAdjust`-ra laposítunk (`flattenAdjustments`) — így semmit nem kell a
 * render-láncban átírni, mégis szerkeszthető marad minden korrekció külön.
 *
 * Kompozíció: a skalár mezők (expozíció, kontraszt, …) SÚLYOZOTTAN ÖSSZEADÓDNAK
 * és a tartományukba vágódnak; a 3-way balance komponensenként összeadódik; a
 * görbe/LUT nem összegezhető egy mezőben → az UTOLSÓ engedélyezett nyer (a
 * teljes, sorrendtartó lánc a `resolvePipeline`-ból jön ki egy jövőbeli
 * több-menetes renderhez). Minden művelet ÚJ vermet ad vissza (command-busz).
 */

/** skalár mezők + tartományuk (a `ClipAdjust` doksijából). */
const RANGES: Record<string, [number, number]> = {
  brightness: [-0.3, 0.3],
  contrast: [-0.4, 0.4],
  saturation: [-1, 1],
  temperature: [-0.3, 0.3],
  vignette: [0, 1],
  exposure: [-1, 1],
  highlights: [-1, 1],
  shadows: [-1, 1],
  whites: [-1, 1],
  blacks: [-1, 1],
  tint: [-0.3, 0.3],
  vibrance: [-1, 1],
  hue: [-1, 1],
  hslSaturation: [-1, 1],
  hslLuminance: [-1, 1],
};
const SCALARS = Object.keys(RANGES) as (keyof ClipAdjust)[];
const ZONES = ['sh', 'mid', 'hi'] as const;
const CHANNELS = ['r', 'g', 'b'] as const;

const DEFAULT_NAME: Record<AdjustmentKind, string> = {
  exposure: 'Expozíció',
  contrast: 'Kontraszt',
  whiteBalance: 'Fehéregyensúly',
  saturation: 'Telítettség',
  vibrance: 'Élénkség',
  hsl: 'HSL',
  curves: 'Görbék',
  colorBalance: 'Színbalansz',
  vignette: 'Vignetta',
  lut: 'LUT',
  custom: 'Korrekció',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;

// ── Verem-műveletek ──────────────────────────────────────────────────────────

/** új korrekciós réteg (engedélyezve, teljes erővel). */
export function createAdjustment(kind: AdjustmentKind, adjust: ClipAdjust = {}, name?: string): AdjustmentLayer {
  return { id: makeId('adj'), kind, name: name ?? DEFAULT_NAME[kind], enabled: true, amount: 1, adjust };
}

/** réteg beszúrása (alapból a verem TETEJÉRE = a lista végére). */
export function addAdjustment(stack: AdjustmentLayer[], layer: AdjustmentLayer, atIndex?: number): AdjustmentLayer[] {
  const out = stack.slice();
  if (atIndex == null || atIndex >= out.length) out.push(layer);
  else out.splice(Math.max(0, atIndex), 0, layer);
  return out;
}

export function removeAdjustment(stack: AdjustmentLayer[], id: string): AdjustmentLayer[] {
  return stack.filter((l) => l.id !== id);
}

/** relatív mozgatás a veremben (delta>0 = feljebb/később alkalmazódik). */
export function reorderAdjustment(stack: AdjustmentLayer[], id: string, delta: number): AdjustmentLayer[] {
  const i = stack.findIndex((l) => l.id === id);
  if (i < 0) return stack;
  const j = clamp(i + delta, 0, stack.length - 1);
  if (i === j) return stack;
  const out = stack.slice();
  const [item] = out.splice(i, 1);
  out.splice(j, 0, item);
  return out;
}

export function moveAdjustment(stack: AdjustmentLayer[], id: string, toIndex: number): AdjustmentLayer[] {
  const i = stack.findIndex((l) => l.id === id);
  if (i < 0) return stack;
  return reorderAdjustment(stack, id, clamp(toIndex, 0, stack.length - 1) - i);
}

export function toggleAdjustment(stack: AdjustmentLayer[], id: string, enabled?: boolean): AdjustmentLayer[] {
  return stack.map((l) => (l.id === id ? { ...l, enabled: enabled ?? !l.enabled } : l));
}

export function setAmount(stack: AdjustmentLayer[], id: string, amount: number): AdjustmentLayer[] {
  return stack.map((l) => (l.id === id ? { ...l, amount: clamp(amount, 0, 1) } : l));
}

/** a korrekció paramétereinek/nevének módosítása (merge az `adjust`-ba). */
export function updateAdjustment(
  stack: AdjustmentLayer[],
  id: string,
  patch: { adjust?: ClipAdjust; name?: string }
): AdjustmentLayer[] {
  return stack.map((l) =>
    l.id === id
      ? { ...l, ...(patch.name != null ? { name: patch.name } : {}), ...(patch.adjust ? { adjust: { ...l.adjust, ...patch.adjust } } : {}) }
      : l
  );
}

export function duplicateAdjustment(stack: AdjustmentLayer[], id: string): AdjustmentLayer[] {
  const i = stack.findIndex((l) => l.id === id);
  if (i < 0) return stack;
  const src = stack[i];
  const copy: AdjustmentLayer = { ...src, id: makeId('adj'), name: `${src.name} másolat`, adjust: cloneAdjust(src.adjust) };
  const out = stack.slice();
  out.splice(i + 1, 0, copy);
  return out;
}

// ── Kompozíció ───────────────────────────────────────────────────────────────

/** egy görbe skálázása identitás felé (`amount`=1 → változatlan, 0 → identitás). */
function scaleCurve(points: CurvePoint[] | undefined, amount: number): CurvePoint[] | undefined {
  if (!points || isIdentityCurve(points)) return undefined;
  if (amount >= 1) return points;
  return points.map((p) => ({ x: p.x, y: round(p.x + (p.y - p.x) * amount) }));
}

function scaleCurves(c: ToneCurves | undefined, amount: number): ToneCurves | undefined {
  if (!c) return undefined;
  const out: ToneCurves = {};
  (['rgb', 'red', 'green', 'blue'] as const).forEach((ch) => {
    const s = scaleCurve(c[ch], amount);
    if (s) out[ch] = s;
  });
  return Object.keys(out).length ? out : undefined;
}

/**
 * A verem → egyetlen effektív `ClipAdjust` (a meglévő render-lánchoz). A skalárok
 * súlyozottan összeadódnak és a tartományukba vágódnak; a balance komponensenként
 * összeadódik; a görbe/LUT nem összegezhető → az UTOLSÓ engedélyezett (nem-üres)
 * nyer, `amount`-tal identitás felé skálázva.
 */
export function flattenAdjustments(stack: AdjustmentLayer[]): ClipAdjust {
  const acc: Record<string, number> = {};
  const bal: Record<string, Record<string, number>> = {};
  let curves: ToneCurves | undefined;
  let lut: ClipLut | undefined;

  for (const layer of stack) {
    if (!layer.enabled || layer.amount <= 0) continue;
    const a = layer.adjust;
    const amt = layer.amount;
    for (const f of SCALARS) {
      const v = a[f] as number | undefined;
      if (typeof v === 'number' && v !== 0) acc[f] = (acc[f] ?? 0) + v * amt;
    }
    if (a.balance) {
      for (const z of ZONES) {
        const zone = a.balance[z];
        if (!zone) continue;
        for (const ch of CHANNELS) {
          const v = zone[ch];
          if (typeof v === 'number' && v !== 0) {
            bal[z] = bal[z] ?? {};
            bal[z][ch] = (bal[z][ch] ?? 0) + v * amt;
          }
        }
      }
    }
    const sc = scaleCurves(a.curves, amt);
    if (sc) curves = sc; // utolsó nyer
    if (a.lut) lut = a.lut; // utolsó nyer
  }

  const out: ClipAdjust = {};
  for (const f of SCALARS) {
    if (acc[f] === undefined) continue;
    const [lo, hi] = RANGES[f];
    const v = round(clamp(acc[f], lo, hi));
    if (v !== 0) (out as Record<string, number>)[f] = v;
  }
  const balOut: NonNullable<ClipAdjust['balance']> = {};
  for (const z of ZONES) {
    if (!bal[z]) continue;
    const zoneOut: Record<string, number> = {};
    for (const ch of CHANNELS) {
      if (bal[z][ch] === undefined) continue;
      const v = round(clamp(bal[z][ch], -1, 1));
      if (v !== 0) zoneOut[ch] = v;
    }
    if (Object.keys(zoneOut).length) balOut[z] = zoneOut;
  }
  if (Object.keys(balOut).length) out.balance = balOut;
  if (curves) out.curves = curves;
  if (lut) out.lut = lut;
  return out;
}

/**
 * A verem → SORRENDTARTÓ effektív `ClipAdjust`-lépések (engedélyezett rétegek,
 * `amount`-tal skálázva). Egy jövőbeli TÖBB-MENETES render ezt a láncot pontosan
 * tudja alkalmazni (a `flatten` egyetlen-mezős közelítése helyett).
 */
export function resolvePipeline(stack: AdjustmentLayer[]): ClipAdjust[] {
  return stack
    .filter((l) => l.enabled && l.amount > 0)
    .map((l) => scaleAdjust(l.adjust, l.amount))
    .filter((a) => !isNeutralAdjust(a));
}

/** egyetlen ClipAdjust skálázása `amount`-tal (skalár·amt, balance·amt, görbe→identitás). */
export function scaleAdjust(a: ClipAdjust, amount: number): ClipAdjust {
  const amt = clamp(amount, 0, 1);
  const out: ClipAdjust = {};
  for (const f of SCALARS) {
    const v = a[f] as number | undefined;
    if (typeof v === 'number' && v !== 0) {
      const [lo, hi] = RANGES[f];
      const scaled = round(clamp(v * amt, lo, hi));
      if (scaled !== 0) (out as Record<string, number>)[f] = scaled;
    }
  }
  if (a.balance) {
    const b: NonNullable<ClipAdjust['balance']> = {};
    for (const z of ZONES) {
      const zone = a.balance[z];
      if (!zone) continue;
      const zoneOut: Record<string, number> = {};
      for (const ch of CHANNELS) {
        const v = zone[ch];
        if (typeof v === 'number' && v !== 0) zoneOut[ch] = round(clamp(v * amt, -1, 1));
      }
      if (Object.keys(zoneOut).length) b[z] = zoneOut;
    }
    if (Object.keys(b).length) out.balance = b;
  }
  const sc = scaleCurves(a.curves, amt);
  if (sc) out.curves = sc;
  if (a.lut && amt > 0) out.lut = a.lut;
  return out;
}

// ── Lekérdezés ───────────────────────────────────────────────────────────────

/** egy ClipAdjust semleges-e (nincs nem-nulla mező / nem-identitás görbe / LUT)? */
export function isNeutralAdjust(a: ClipAdjust): boolean {
  for (const f of SCALARS) if (typeof a[f] === 'number' && a[f] !== 0) return false;
  if (a.balance) {
    for (const z of ZONES) {
      const zone = a.balance[z];
      if (zone) for (const ch of CHANNELS) if (typeof zone[ch] === 'number' && zone[ch] !== 0) return false;
    }
  }
  if (a.curves) {
    for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
      if (a.curves[ch] && !isIdentityCurve(a.curves[ch])) return false;
    }
  }
  if (a.lut) return false;
  return true;
}

/** a verem semleges-e (nincs engedélyezett, ható korrekció)? */
export function isNeutralStack(stack: AdjustmentLayer[]): boolean {
  return isNeutralAdjust(flattenAdjustments(stack));
}

/** rövid összefoglaló a UI-hoz: hány réteg, hány aktív. */
export function summarizeStack(stack: AdjustmentLayer[]): { total: number; active: number; kinds: AdjustmentKind[] } {
  const active = stack.filter((l) => l.enabled && l.amount > 0 && !isNeutralAdjust(l.adjust));
  return { total: stack.length, active: active.length, kinds: active.map((l) => l.kind) };
}

function cloneAdjust(a: ClipAdjust): ClipAdjust {
  return JSON.parse(JSON.stringify(a)) as ClipAdjust;
}
