import type { GradientStop, ShapeGradient } from '@/types/project';

/** expo-linear-gradient start/end pontja a CSS-szögből (0° = fel, óramutató szerint). */
export function angleToLinearPoints(angle = 135): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  return {
    start: { x: 0.5 - dx / 2, y: 0.5 - dy / 2 },
    end: { x: 0.5 + dx / 2, y: 0.5 + dy / 2 },
  };
}

/** `at` szerint növekvő, 0…1-be zárt stopok. */
export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops]
    .map((s) => ({ color: s.color, at: Math.min(1, Math.max(0, s.at)) }))
    .sort((a, b) => a.at - b.at);
}

export const DEFAULT_GRADIENT: ShapeGradient = {
  type: 'linear',
  angle: 135,
  stops: [
    { color: '#7c5cff', at: 0 },
    { color: '#ff2ea6', at: 1 },
  ],
};
