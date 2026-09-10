import { buildCameraMove } from '@/lib/camera3d';
import type {
  Clip,
  LightingPreset,
  Project,
  TransitionOut,
} from '@/types/project';

/**
 * 🎬 Motion-preset csomagok (🧊 3D V2): egy koppintásos „look” — a meglévő
 * építőkockák (kamera-kulcskockák + 3D átmenetek + lighting) kurátori
 * kombinációi a teljes videósávra. Konzervatív: a már kulcskockázott klipeket
 * nem bántja, az utolsó klip nem kap kimenő átmenetet. Pure, tesztelhető.
 */

export type MotionPack = 'cinematic' | 'social' | 'gaming' | 'product';

interface PackSpec {
  label: string;
  lighting: LightingPreset;
  /** kamera-preset a kulcskocka-motorra (camera3d) */
  camera: Parameters<typeof buildCameraMove>[0];
  /** átmenet-típusok körforgásban a klipek közt */
  transitions: TransitionOut['type'][];
  transitionDuration: number;
}

export const MOTION_PACKS: Record<MotionPack, PackSpec> = {
  cinematic: {
    label: '🎬 Cinematic',
    lighting: 'cyberpunk',
    camera: 'pushIn',
    transitions: ['dissolve'],
    transitionDuration: 0.7,
  },
  social: {
    label: '📱 Social',
    lighting: 'neon',
    camera: 'dramaticZoom',
    transitions: ['zoom', 'spin'],
    transitionDuration: 0.4,
  },
  gaming: {
    label: '🎮 Gaming',
    lighting: 'cyberpunk',
    camera: 'hero',
    transitions: ['spin', 'flip'],
    transitionDuration: 0.35,
  },
  product: {
    label: '🛍️ Product',
    lighting: 'studio',
    camera: 'orbit',
    transitions: ['dissolve'],
    transitionDuration: 0.6,
  },
};

export interface MotionPackPlan {
  clips: Clip[];
  /** hány klip kapott stílust */
  touched: number;
  /** kulcskockás klipek, amiket a kamera-rész kihagyott */
  skippedCamera: number;
}

export function buildMotionPackPlan(
  project: Project,
  pack: MotionPack
): MotionPackPlan | null {
  const spec = MOTION_PACKS[pack];
  const track = project.tracks.find((t) => t.type === 'video');
  if (!spec || !track) {
    return null;
  }
  const visuals = track.clips.filter(
    (c) => c.kind === 'video' || c.kind === 'image'
  );
  if (visuals.length === 0) {
    return null;
  }
  let touched = 0;
  let skippedCamera = 0;
  let visualIdx = 0;
  const clips = track.clips.map((clip) => {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      return clip;
    }
    const idx = visualIdx++;
    const isLast = idx === visuals.length - 1;
    const next = { ...clip, lighting: spec.lighting };
    // átmenet a következő klipre — az utolsó nem kap
    next.transitionOut = isLast
      ? undefined
      : {
          type: spec.transitions[idx % spec.transitions.length],
          duration: spec.transitionDuration,
        };
    // kameramozgás csak a még kulcskocka nélküli klipekre
    if (clip.keyframes) {
      skippedCamera += 1;
    } else {
      next.keyframes = buildCameraMove(spec.camera, clip.duration).keyframes;
      const tilt = buildCameraMove(spec.camera, clip.duration).tilt3d;
      next.tilt3d = tilt ?? next.tilt3d;
    }
    touched += 1;
    return next;
  });
  return { clips, touched, skippedCamera };
}
