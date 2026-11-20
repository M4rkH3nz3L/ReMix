import type { booleanShapes } from '@/lib/boolean';
import { clipEnd } from '@/lib/projectUtils';
import type { ShapeClip } from '@/types/project';

/**
 * 🔷 A videó-szerkesztő Forma-paneljének (`components/editor/panels/ShapePanel.tsx`)
 * tiszta, expo-mentes magja: a preset-listák és a boolean-kombináció eredmény-klipje
 * — önmagukban tesztelhetők.
 */

export const GRADIENTS: { id: string; from: string; to: string }[] = [
  { id: 'purplePink', from: '#7c5cff', to: '#ff5ca8' },
  { id: 'blueTurquoise', from: '#4d9dff', to: '#5cffd0' },
  { id: 'sunset', from: '#ff6b4a', to: '#ffb85c' },
];

export const GLOW_PRESETS = [
  { id: 'cyan', emoji: '🩵', color: '#00e5ff' },
  { id: 'pink', emoji: '💗', color: '#ff2d95' },
  { id: 'white', emoji: '🤍', color: '#ffffff' },
  { id: 'gold', emoji: '💛', color: '#ffd166' },
];

export const OUTLINE_PRESETS = [
  { id: 'white', emoji: '🤍', color: '#ffffff' },
  { id: 'black', emoji: '🖤', color: '#0b0b18' },
  { id: 'pink', emoji: '💗', color: '#ff2d95' },
];

/** a boolean-kombináció új path-klipje: a két forma közös idősávja, vászon-térben (w=h=1, középen) */
export function booleanResultClip(
  clip: ShapeClip,
  other: ShapeClip,
  result: NonNullable<ReturnType<typeof booleanShapes>>,
  id: string
): ShapeClip {
  const start = Math.min(clip.start, other.start);
  const duration = Math.max(clipEnd(clip), clipEnd(other)) - start;
  return {
    kind: 'shape',
    id,
    start,
    duration,
    shape: 'path',
    closed: true,
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    fill: clip.fill,
    subpaths: result.subpaths,
    fillRule: result.fillRule,
    ...(clip.gradient ? { gradient: clip.gradient } : {}),
  };
}
