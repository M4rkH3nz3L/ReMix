import type { GradeId } from '@/types/project';

/**
 * Filmes grade-presetek (LUT-szerű „look"-ok) a grade-rétegre. Ez a KLIENS-oldali
 * metaadat: a választó-chipek + az előnézeti tint-közelítés. A valódi split-tone
 * color-grade a renderben ég be (`server/render.js` GRADES-térképe UGYANEZEKKEL az
 * id-kkal) — a kettő együtt módosítandó, hogy az előnézet és az export egyezzen.
 *
 * A `tint` féligátlátszó rétegek listája (fentről lefelé), amivel az előnézet
 * közelíti a look-ot — mint a szűrők/lighting overlay-közelítése.
 */
export interface GradeMeta {
  id: GradeId;
  label: string;
  tint: { color: string; opacity: number }[];
}

export const GRADES: GradeMeta[] = [
  { id: 'none', label: 'Nincs', tint: [] },
  {
    id: 'teal-orange',
    label: '🎬 Teal & Orange',
    tint: [
      { color: '#0f6b6b', opacity: 0.12 },
      { color: '#ff8c42', opacity: 0.1 },
    ],
  },
  { id: 'moody', label: '🌧️ Moody', tint: [{ color: '#0d1b2a', opacity: 0.24 }] },
  { id: 'vintage', label: '📽️ Vintage', tint: [{ color: '#d8c9a0', opacity: 0.2 }] },
  { id: 'noir', label: '⚫ Noir', tint: [{ color: '#808080', opacity: 0.5 }] },
  { id: 'warm-film', label: '☀️ Warm Film', tint: [{ color: '#ff9d4d', opacity: 0.16 }] },
  { id: 'cold', label: '❄️ Cold', tint: [{ color: '#4d9dff', opacity: 0.16 }] },
  { id: 'vibrant', label: '🌈 Vibrant', tint: [{ color: '#ff2ea6', opacity: 0.07 }] },
  { id: 'dreamy', label: '💗 Dreamy', tint: [{ color: '#ffd6e8', opacity: 0.16 }] },
];

/** id → tint-rétegek (előnézeti közelítés); ismeretlen/none → üres. */
export function gradeTint(id: GradeId | undefined): { color: string; opacity: number }[] {
  if (!id || id === 'none') {
    return [];
  }
  return GRADES.find((g) => g.id === id)?.tint ?? [];
}
