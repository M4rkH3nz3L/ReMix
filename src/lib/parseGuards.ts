/**
 * 🛡️ Határ-validáció — a worker/AI válaszai és a projekt közötti ellenőrzőpont.
 *
 * A kliens-modulok eddig a VÁLASZ ALAKJÁT nézték (`Array.isArray`, `length > 0`),
 * a TARTALMÁT nem. Márpedig ezek a számok egyenesen klip-időkké, vágáspontokká
 * és kulcskockákká válnak: egyetlen `NaN`, `null` vagy negatív érték csendben
 * megromlott idővonalat csinál, amit a felhasználó csak jóval később vesz észre
 * — és amit az undo sem javít meg, mert szabályos szerkesztésként ment át.
 *
 * Az őrök SZŰRNEK, nem dobnak: a hibás elem kiesik, a jó adat megmarad. Egy
 * félresikerült elemzés így részleges eredményt ad a semmi helyett, de romlott
 * adatot soha nem enged be.
 */

/** véges szám vagy `null` — a `NaN`/`Infinity`/`"12"`/`null` mind kiesik */
export function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** véges, nem negatív szám (idő, hossz) vagy `null` */
export function finiteTime(v: unknown): number | null {
  const n = finiteNum(v);
  return n !== null && n >= 0 ? n : null;
}

/** 0–1 közé szorított véges szám vagy `null` (normalizált pozíció) */
export function unitNum(v: unknown): number | null {
  const n = finiteNum(v);
  return n === null ? null : Math.min(1, Math.max(0, n));
}

/** string vagy `null` — a number/null/undefined/objektum kiesik */
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** boolean vagy a megadott alapérték (a bool nem „esik ki", csak default-ol) */
export function boolOr(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** string-lista: a nem-string elemek kiesnek (üres tömb, ha nem tömb) */
export function strList(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string');
}

/**
 * Objektum-narrower: plain object vagy `null` (tömb/null/primitív → null). A
 * `res.json()` BIZTONSÁGOS tipizálásához (a `… as SomeType` helyett, audit §12.1):
 *   `const o = asRecord(await res.json()); const name = str(o?.name);`
 */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Időpont-lista (pl. jelenetváltások): a nem véges / negatív elemek kiesnek,
 * az eredmény NÖVEKVŐ és duplikátum-mentes — a vágás-logika ezt feltételezi.
 */
export function timeList(v: unknown, opts: { max?: number } = {}): number[] {
  const out: number[] = [];
  for (const raw of asArray(v)) {
    const t = finiteTime(raw);
    if (t !== null && (opts.max === undefined || t <= opts.max)) {
      out.push(t);
    }
  }
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || t !== out[i - 1]);
}

/**
 * Idő-intervallumok (pl. csend-tartományok): csak a `0 <= start < end` párok
 * maradnak — a fordított vagy nulla hosszú tartomány negatív klip-hosszt szülne.
 */
export function rangeList(v: unknown, opts: { max?: number } = {}): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const raw of asArray(v)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const r = raw as { start?: unknown; end?: unknown };
    const start = finiteTime(r.start);
    const end = finiteTime(r.end);
    if (start === null || end === null || end <= start) {
      continue;
    }
    if (opts.max !== undefined && start > opts.max) {
      continue;
    }
    out.push({ start, end: opts.max === undefined ? end : Math.min(end, opts.max) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Objektum-lista leképezése úgy, hogy a `null`-t adó elemek kiesnek. Ezzel a
 * hívó csak az EGY elem validálását írja le, a szűrés közös.
 */
export function mapValid<T>(v: unknown, parse: (item: Record<string, unknown>) => T | null): T[] {
  const out: T[] = [];
  for (const raw of asArray(v)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const parsed = parse(raw as Record<string, unknown>);
    if (parsed !== null) {
      out.push(parsed);
    }
  }
  return out;
}
