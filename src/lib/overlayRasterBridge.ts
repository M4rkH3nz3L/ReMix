import type { Project } from '@/types/project';

/**
 * 🌉 Overlay-raszter híd: a render-út (lib) és a szerkesztőben ülő raszter-host
 * (React-komponens) közti kapocs. A szöveg-PNG-k a TÉNYLEGES preview-komponens
 * natív snapshotjából készülnek (Skia `makeImageFromView`) — ehhez mountolt
 * React-fa kell, ezért a host a szerkesztő-képernyőn él, és itt regisztrál.
 * Host nélkül (nem-editor kontextus) a `canRenderLocally` felhőre enged.
 */

export interface OverlayRasterRequest {
  project: Project;
  /** a raszter-vászon mérete dp-ben (a kimeneti képarányban) */
  width: number;
  height: number;
  /** a raszterizálandó szöveg-klip id-k */
  clipIds: string[];
}

export type OverlayRasterHandler = (
  req: OverlayRasterRequest,
) => Promise<Map<string, string /* png uri */>>;

let handler: OverlayRasterHandler | null = null;

/** a host regisztrációja (mount/unmount) — leiratkozót ad */
export function registerOverlayRasterHost(h: OverlayRasterHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) {
      handler = null;
    }
  };
}

/** van-e aktív raszter-host (a canRenderLocally szinkron kapuja) */
export function hasOverlayRasterHost(): boolean {
  return handler != null;
}

/** szöveg-klipek raszterizálása PNG-fájlokba (clipId → file uri) */
export async function rasterTextOverlays(
  req: OverlayRasterRequest,
): Promise<Map<string, string>> {
  if (!handler) {
    throw new Error('Nincs overlay-raszter host (a szerkesztőből indított render adja).');
  }
  return handler(req);
}
