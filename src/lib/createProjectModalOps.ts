/**
 * ➕ Az „Új projekt" modal (src/components/studio/CreateProjectModal.tsx) tiszta,
 * expo-mentes magja: a hang master-cél opciói és a mező-szűrők/-leképezések.
 * A modalból kiemelve (REFACTOR) — a viselkedés változatlan.
 */
import { AUDIO_MASTER_TARGETS } from '@/lib/audioMaster';
import { clampDim } from '@/lib/canvasPresets';
import type { Asset } from '@/types/project';

/** 🎚️ a hang-projekt választható master-céljai (a 'custom' nem induló-beállítás). */
export const AUDIO_TARGETS = AUDIO_MASTER_TARGETS.filter((tg) => tg !== 'custom');

/** a W×H mezőbe csak számjegy kerülhet */
export function digitsOnly(v: string): string {
  return v.replace(/[^0-9]/g, '');
}

/** a vászon-preset akkor aktív, ha a (szorított) W×H pontosan egyezik vele */
export function isCanvasPresetActive(imgW: string, imgH: string, p: { w: number; h: number }): boolean {
  return clampDim(imgW) === p.w && clampDim(imgH) === p.h;
}

/** a hex-mező értéke: átlátszó háttérnél üres */
export function bgHexValue(bg: string): string {
  return bg === 'transparent' ? '' : bg;
}

/** a forrás-mappa elemének ikonja a fájl fajtája szerint */
export function sourceAssetIcon(kind: Asset['kind']): 'videocam' | 'musical-notes' | 'image' {
  return kind === 'video' ? 'videocam' : kind === 'audio' ? 'musical-notes' : 'image';
}
