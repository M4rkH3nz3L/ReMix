/**
 * ⬜ Sarok-lekerekítés tokenek. Eddig szórt literálok éltek (2/4/6/8/10/12/14/
 * 16/18/999) — itt egy konzisztens skála. A `pill` a teljesen lekerekített
 * (kapszula) elemekhez; `full` a körökhöz (avatar).
 */
export const radius = {
  /** apró jelölés, progress-sáv */
  xs: 4,
  /** chip, kis gomb */
  sm: 6,
  /** alap kártya, input, gomb — az alapértelmezett */
  md: 10,
  /** panel, nagyobb kártya */
  lg: 14,
  /** kiemelt felület, modal */
  xl: 18,
  /** bottom sheet teteje */
  xxl: 24,
  /** kapszula (teljesen lekerekített téglalap) */
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
