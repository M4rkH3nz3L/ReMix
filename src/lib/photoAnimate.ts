import type { ClipKeyframes } from '@/types/project';

/**
 * Animate Photo (Creative Canvas): egy-koppintásos mozgás-presetek állóképre
 * (és videóra is működnek) — a meglévő kulcskocka-engine-re fordulnak, így az
 * előnézet és a render változtatás nélkül viszi. Pure, tesztelhető.
 */

export type PhotoAnimPreset =
  | 'kenburns'
  | 'zoomIn'
  | 'zoomOut'
  | 'panLeft'
  | 'panRight'
  | 'floating';

export const PHOTO_ANIM_PRESETS: { id: PhotoAnimPreset; label: string }[] = [
  { id: 'kenburns', label: 'Ken Burns' },
  { id: 'zoomIn', label: 'Zoom be' },
  { id: 'zoomOut', label: 'Zoom ki' },
  { id: 'panLeft', label: 'Pan ←' },
  { id: 'panRight', label: 'Pan →' },
  { id: 'floating', label: 'Lebegés' },
];

/** preset → kulcskockák a klip hosszára (mp) */
export function buildPhotoAnimation(
  preset: PhotoAnimPreset,
  duration: number
): ClipKeyframes {
  const d = Math.max(0.5, duration);
  switch (preset) {
    case 'kenburns':
      return {
        scale: [
          { time: 0, value: 1.08, easing: 'easeInOut' },
          { time: d, value: 1.45, easing: 'easeInOut' },
        ],
        x: [
          { time: 0, value: -0.05, easing: 'easeInOut' },
          { time: d, value: 0.07, easing: 'easeInOut' },
        ],
        y: [
          { time: 0, value: 0.03, easing: 'easeInOut' },
          { time: d, value: -0.04, easing: 'easeInOut' },
        ],
      };
    case 'zoomIn':
      return {
        scale: [
          { time: 0, value: 1, easing: 'easeInOut' },
          { time: d, value: 1.5, easing: 'easeInOut' },
        ],
      };
    case 'zoomOut':
      return {
        scale: [
          { time: 0, value: 1.5, easing: 'easeOut' },
          { time: d, value: 1, easing: 'easeOut' },
        ],
      };
    case 'panLeft':
      return {
        scale: [{ time: 0, value: 1.25, easing: 'linear' }],
        x: [
          { time: 0, value: 0.1, easing: 'easeInOut' },
          { time: d, value: -0.1, easing: 'easeInOut' },
        ],
      };
    case 'panRight':
      return {
        scale: [{ time: 0, value: 1.25, easing: 'linear' }],
        x: [
          { time: 0, value: -0.1, easing: 'easeInOut' },
          { time: d, value: 0.1, easing: 'easeInOut' },
        ],
      };
    case 'floating':
      return {
        scale: [
          { time: 0, value: 1.15, easing: 'easeInOut' },
          { time: d / 2, value: 1.22, easing: 'easeInOut' },
          { time: d, value: 1.15, easing: 'easeInOut' },
        ],
        y: [
          { time: 0, value: -0.02, easing: 'easeInOut' },
          { time: d / 2, value: 0.02, easing: 'easeInOut' },
          { time: d, value: -0.02, easing: 'easeInOut' },
        ],
      };
  }
}
