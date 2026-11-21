import { palette } from '@/constants/editor';
import type { FaceBox } from '@/lib/faceClient';
import type { ParticlesConfig, ParticlesPreset, VideoClip } from '@/types/project';

/**
 * 🙂 A videó-szerkesztő matrica-paneljének (`components/editor/panels/StickerPanel.tsx`)
 * expo-mentes magja: a forma-klipek kezdő-geometriája, az arc-matrica elhelyezése,
 * a logó kezdőmérete, az ecset-vastagság lépése, a részecske-preset és a 3D-előnézet
 * URL-je. (REFACTOR: a StickerPanel.tsx-ből kiemelve, a számítás változatlan.)
 */

export type StickerShape = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'star';

/** a beszúrt forma kezdő mérete, kitöltése és sarok-lekerekítése */
export function shapeDefaults(shape: StickerShape) {
  return {
    w: shape === 'line' ? 0.6 : shape === 'star' ? 0.3 : 0.42,
    h:
      shape === 'line'
        ? 0.006
        : shape === 'ellipse'
          ? 0.24
          : shape === 'arrow'
            ? 0.12
            : shape === 'star'
              ? 0.17
              : 0.2,
    fill: shape === 'line' ? '#ffffff' : shape === 'star' ? '#ffd166' : palette.accent,
    cornerRadius: shape === 'rectangle' ? 0.15 : 0,
  };
}

/** az arc-matrica hossza, betűmérete és helye (az arc fölé, a homlok/haj vonalába) */
export function faceStickerLayout(face: FaceBox, video: VideoClip, playhead: number) {
  const duration = Math.min(4, video.start + video.duration - playhead);
  return {
    duration: Math.max(1, duration),
    fontSize: Math.round(Math.max(8, Math.min(30, face.h * 90))),
    position: { x: face.x, y: Math.max(0.05, face.y - face.h * 0.75) },
  };
}

/** a kép-méretből az arány (érvénytelen méretnél 1) */
export function imageAspect(w: number, h: number): number {
  return w > 0 && h > 0 ? w / h : 1;
}

/** a logó kezdő-magassága: vászon 9:16 → a magasság-arányt a vászon-arány korrigálja közelítőleg */
export function logoHeight(w: number, aspect: number): number {
  return Math.min(0.6, (w / aspect) * 0.5625);
}

/** az ecset-vastagság egy lépése (0,2%), 0,2 és 6 közé szorítva */
export function brushWidthStep(width: number, dir: -1 | 1): number {
  return dir < 0
    ? Math.max(0.2, Math.round((width - 0.2) * 10) / 10)
    : Math.min(6, Math.round((width + 0.2) * 10) / 10);
}

/** részecske-preset kiválasztása: a beat-sync és az intenzitás az előzőből marad */
export function particlesFor(preset: ParticlesPreset, particles: ParticlesConfig | undefined): ParticlesConfig {
  return {
    preset,
    beatSync: particles?.beatSync ?? true,
    intensity: particles?.intensity ?? 1,
  };
}

/** a 3D-objektum előnézeti képe a workerről (anyag + környezet szerint) */
export function sticker3dPreviewUrl(server: string, entryUrl: string, material: string, environment: string): string {
  return `${server}${entryUrl}?size=160` + `&material=${material}&env=${environment}`;
}
