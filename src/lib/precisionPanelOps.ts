import { snapToFrame } from '@/lib/frames';
import type { KeyframeChannel } from '@/lib/keyframes';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🎯 A videó-szerkesztő Precíziós paneljének (`components/editor/panels/PrecisionPanel.tsx`)
 * tiszta, expo-mentes magja: a Graph Editor csatornái és a lépés-mód szerinti
 * (másodperc / képkocka-rács) kerekítés — önmagukban tesztelhetők.
 */

export const STEP = 0.1;

/**
 * 🎞️ A Graph Editorban szerkeszthető transzform-csatornák (videó/kép): érték-
 * tartomány + a kulcskocka nélküli szél-érték + megjelenítés.
 */
export type ChannelCfg = {
  id: Extract<KeyframeChannel, 'scale' | 'x' | 'y' | 'rotation' | 'opacity'>;
  label: string;
  min: number;
  max: number;
  fallback: (clip: VideoClip | ImageClip) => number;
  fmt: (v: number) => string;
};
export const TRANSFORM_CHANNELS: ChannelCfg[] = [
  { id: 'scale', label: 'panels.precision.chScale', min: 0.2, max: 4, fallback: (c) => c.transform?.scale ?? 1, fmt: (v) => `${v.toFixed(2)}×` },
  { id: 'x', label: 'panels.precision.chX', min: -0.75, max: 0.75, fallback: (c) => c.transform?.x ?? 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'y', label: 'panels.precision.chY', min: -0.75, max: 0.75, fallback: (c) => c.transform?.y ?? 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'rotation', label: 'panels.precision.chRotation', min: -180, max: 180, fallback: (c) => c.transform?.rotation ?? 0, fmt: (v) => `${Math.round(v)}°` },
  { id: 'opacity', label: 'panels.precision.chOpacity', min: 0, max: 1, fallback: (c) => c.opacity ?? 1, fmt: (v) => `${Math.round(v * 100)}%` },
];

/**
 * A léptetés finomsága. Kockára állítva az érték a render KÉPKOCKA-RÁCSÁRA
 * kerekedik (nem tizedmásodpercre) — SFX-, felirat- és vágás-igazításnál ez
 * kell, mert fél kocka csúszás már látszik/hallatszik.
 */
export type StepMode = 'sec' | 'frame';

/** kerekítés a lépés-mód szerint (frame-módban a projekt frame-rácsára) */
export function snap(value: number, mode: StepMode, fps: number): number {
  return mode === 'frame' ? snapToFrame(value, fps) : Math.round(value * 100) / 100;
}
