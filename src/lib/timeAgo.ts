/**
 * ⏱️ Rövid relatív idő az üzenet-listákhoz — egység + szám, a fordító adja a formát.
 *
 * MIÉRT: a korábbi kézzel írt „5n / 1h" magyarul félreérthető volt (a „h" hetet
 * jelentett, de órának olvasható), és nem volt lokalizálva. Itt csak az egységet és
 * a számot döntjük el; a megjelenítés i18n-kulcs (`time.ago_<unit>`).
 */
export type AgoUnit = 'now' | 'minute' | 'hour' | 'day' | 'week';

export function timeAgoParts(iso: string, now = Date.now()): { unit: AgoUnit; count: number } {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 60) return { unit: 'now', count: 0 };
  if (s < 3600) return { unit: 'minute', count: Math.floor(s / 60) };
  if (s < 86400) return { unit: 'hour', count: Math.floor(s / 3600) };
  if (s < 604800) return { unit: 'day', count: Math.floor(s / 86400) };
  return { unit: 'week', count: Math.floor(s / 604800) };
}
