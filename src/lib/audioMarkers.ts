import type { Marker } from '@/types/project';

/**
 * 🔖 Markerek a Hang Stúdióban (a projekt KÖZÖS `markers`-e — a videó-szerkesztő ugyanezt látja).
 * Pure segédek: hozzáadás időrendben, a közeli marker megtalálása, snap a markerekre, zenei
 * szakasz-címkék. A módosítás a hívónál `SET_MARKERS` parancs (undo-zható).
 */

/** zenei szakaszok (i18n-kulcs utótag + szín) */
export const SECTION_KINDS = [
  { key: 'intro', color: '#60a5fa' },
  { key: 'verse', color: '#34d399' },
  { key: 'preChorus', color: '#a3e635' },
  { key: 'chorus', color: '#f472b6' },
  { key: 'bridge', color: '#fbbf24' },
  { key: 'outro', color: '#a78bfa' },
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number]['key'];

/** új marker időrendben (azonos időre nem tesz kettőt) */
export function addMarker(markers: Marker[], m: Marker): Marker[] {
  if (markers.some((x) => Math.abs(x.time - m.time) < 1e-3)) {
    return markers;
  }
  return [...markers, m].sort((a, b) => a.time - b.time);
}

/** a `t`-hez `tol` mp-en belüli legközelebbi marker */
export function nearestMarker(markers: Marker[], t: number, tol: number): Marker | null {
  let best: Marker | null = null;
  for (const m of markers) {
    if (Math.abs(m.time - t) <= tol && (!best || Math.abs(m.time - t) < Math.abs(best.time - t))) best = m;
  }
  return best;
}

/** snap a markerre, ha `tol` mp-en belül van (különben az eredeti idő) */
export function snapToMarkers(sec: number, markers: Marker[], tol: number): number {
  return nearestMarker(markers, sec, tol)?.time ?? sec;
}

/** a következő / előző marker ideje (navigáció) */
export function adjacentMarker(markers: Marker[], t: number, dir: 1 | -1): number | null {
  const times = markers.map((m) => m.time).sort((a, b) => a - b);
  if (dir > 0) return times.find((x) => x > t + 1e-3) ?? null;
  return [...times].reverse().find((x) => x < t - 1e-3) ?? null;
}
