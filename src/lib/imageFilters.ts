/**
 * 🎛️ Kép-szűrő UI-mag (IMGEDD §5) — pure + tesztelt.
 *
 * A foto-réteg `filters` vermének kezelése (hozzáad/levesz/erősség). A tényleges render a worker
 * `imageFilters.js`-ében (ffmpeg); itt csak a UI-logika él. Expo-mentes.
 */
import type { ImageFilter, ImageFilterType } from '@/types/project';

export const IMAGE_FILTER_TYPES: { type: ImageFilterType; label: string; icon: string }[] = [
  { type: 'blur', label: 'Elmosás', icon: 'water-outline' },
  { type: 'sharpen', label: 'Élesítés', icon: 'triangle-outline' },
  { type: 'noise', label: 'Zaj', icon: 'apps-outline' },
  { type: 'grayscale', label: 'Szürke', icon: 'contrast-outline' },
  { type: 'sepia', label: 'Szépia', icon: 'sunny-outline' },
  { type: 'clarity', label: 'Tisztaság', icon: 'sparkles-outline' },
  { type: 'dehaze', label: 'Párátlanítás', icon: 'cloudy-outline' },
  { type: 'pixelate', label: 'Pixeles', icon: 'grid-outline' },
  { type: 'posterize', label: 'Poszter', icon: 'layers-outline' },
];

export const DEFAULT_FILTER_AMOUNT = 0.6;

export function hasFilter(filters: ImageFilter[] | undefined, type: ImageFilterType): boolean {
  return (filters ?? []).some((f) => f.type === type);
}

export function getFilterAmount(filters: ImageFilter[] | undefined, type: ImageFilterType): number {
  return (filters ?? []).find((f) => f.type === type)?.amount ?? DEFAULT_FILTER_AMOUNT;
}

/** Egy szűrő be/ki (toggle). Bekapcsoláskor a `filters` VÉGÉRE kerül (sorrend = render-sorrend). */
export function toggleFilter(
  filters: ImageFilter[] | undefined,
  type: ImageFilterType,
  amount = DEFAULT_FILTER_AMOUNT
): ImageFilter[] {
  const list = filters ?? [];
  return hasFilter(list, type) ? list.filter((f) => f.type !== type) : [...list, { type, amount }];
}

/** Egy aktív szűrő erősségének állítása (0–1). Ha nincs ilyen szűrő, no-op. */
export function setFilterAmount(
  filters: ImageFilter[] | undefined,
  type: ImageFilterType,
  amount: number
): ImageFilter[] {
  const a = Math.max(0, Math.min(1, amount));
  return (filters ?? []).map((f) => (f.type === type ? { ...f, amount: a } : f));
}
