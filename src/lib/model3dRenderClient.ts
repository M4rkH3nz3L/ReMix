import { File, Paths } from 'expo-file-system';

import { makeId } from '@/lib/id';
import { exportFileName } from '@/lib/model3dExport';
import { planRenderJob } from '@/lib/model3dRenderJob';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { Remix3D } from '@/lib/remix3dNative';
import type { MeshFormat } from '@/types/model3d';

/**
 * 🧊→🖼️/🎬 A 3D-modell felhasználása máshol: állókép (átlátszó PNG), 360°-os forgó
 * videó (MP4) és modell-fájl export — mind a KÉSZÜLÉKEN (remix-3d natív modul). A
 * kép/videó a NYITOTT projekt mappájába kerül (`projectMediaDir()`), így a videó-
 * szerkesztőben a saját projektjének része lesz (nem hivatkozik a 3D-projektre).
 */

/** elérhető-e a 3D-renderelés (LiDAR-os iPhone + a natív modul) */
export function model3dRenderAvailable(): boolean {
  return Remix3D != null;
}

/** a forgó videó a natív modul újabb verziójában van (régi app-build → új build kell) */
export function turntableAvailable(): boolean {
  return typeof Remix3D?.renderTurntable === 'function';
}

export interface StillOptions {
  /** vízszintes szög (radián) */
  yaw?: number;
  /** függőleges szög (radián) */
  pitch?: number;
  size?: number;
  transparent?: boolean;
}

/** 🖼️ Állókép a modellből → PNG uri (alap: átlátszó háttér, enyhén felülről). */
export async function renderModelStill(modelUri: string, opts: StillOptions = {}): Promise<string> {
  if (!Remix3D) {
    throw new Error('model3d.error.unsupported');
  }
  const out = new File(projectMediaDir(), `m3d_still_${makeId('img')}.png`);
  const size = opts.size ?? 1024;
  return Remix3D.snapshotFile(
    modelUri,
    out.uri,
    size,
    size,
    opts.yaw ?? Math.PI / 6,
    opts.pitch ?? Math.PI / 9,
    opts.transparent ?? true
  );
}

export interface TurntableOptions {
  /** a cél-videó képaránya (pl. a videó-projekté: '9:16') */
  aspectRatio: string;
  seconds?: number;
  fps?: number;
  pitch?: number;
  /** `#rrggbb` háttér (null → a stúdió sötét alapja) */
  background?: string | null;
}

/**
 * 🎬 360°-os forgó felvétel → MP4 uri + a hossza. A méretet a pure `planRenderJob`
 * adja (1080p, a cél képarányában); a haladás 0–1 között jön. Megszakítás:
 * `cancelModelRender()`.
 */
export async function renderModelTurntable(
  modelUri: string,
  opts: TurntableOptions,
  onProgress?: (fraction: number) => void
): Promise<{ uri: string; seconds: number }> {
  if (!Remix3D || !turntableAvailable()) {
    throw new Error('model3d.error.needsNewBuild');
  }
  const seconds = opts.seconds ?? 6;
  const fps = opts.fps ?? 30;
  const { plan, errors } = planRenderJob({
    target: 'video',
    aspectRatio: opts.aspectRatio,
    resolution: '1080',
    transparent: false,
    seconds,
    fps,
  });
  if (!plan) {
    throw new Error(errors[0] ?? 'model3d.render.errAspect');
  }
  const out = new File(projectMediaDir(), `m3d_turntable_${makeId('vid')}.mp4`);
  const sub = onProgress ? Remix3D.addListener('onRenderProgress', (e) => onProgress(e.progress)) : null;
  try {
    const uri = await Remix3D.renderTurntable(
      modelUri,
      out.uri,
      plan.width,
      plan.height,
      seconds,
      fps,
      opts.pitch ?? Math.PI / 12,
      opts.background ?? null
    );
    return { uri, seconds };
  } finally {
    sub?.remove();
  }
}

export function cancelModelRender(): void {
  void Remix3D?.cancelRender?.();
}

/** 📦 A modell-fájl exportja a kért formátumba (a cache-be, megosztáshoz) → uri. */
export async function exportModelFile(modelUri: string, projectName: string, format: MeshFormat): Promise<string> {
  if (!Remix3D) {
    throw new Error('model3d.error.unsupported');
  }
  const out = new File(Paths.cache, exportFileName(projectName, format));
  return Remix3D.exportModel(modelUri, out.uri);
}
