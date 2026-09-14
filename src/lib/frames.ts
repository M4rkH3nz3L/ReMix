import type { Project } from '@/types/project';

/**
 * 🎞️ Frame-kvantált idő-modell (Timeline precision). Az app ideje másodpercben
 * él (rAF-mesteróra), de a PROFI vágás képkockára ül: a vágások, kulcskockák és
 * léptetések a projekt frame-rácsára kerekednek, és az idő `HH:MM:SS:FF`
 * timecode-ként jelenik meg. Ez a réteg a projekt frame-rátáját (`project.fps`)
 * teszi az egyetlen igazságforrássá. Pure (csak típus-import) → tesztelhető.
 */

/** alap szerkesztési frame-ráta (a régi, fps nélküli projektek erre esnek vissza) */
export const DEFAULT_FPS = 30;

/** választható szerkesztési frame-ráták (timebase) */
export const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;

/** a projekt frame-rátája (fallback a régi projektekhez) */
export function projectFps(project: Pick<Project, 'fps'> | null | undefined): number {
  const fps = project?.fps;
  return typeof fps === 'number' && fps > 0 ? fps : DEFAULT_FPS;
}

/** egy képkocka hossza másodpercben */
export function frameDuration(fps: number): number {
  return 1 / (fps > 0 ? fps : DEFAULT_FPS);
}

/** mp → (kerekített) képkocka-index */
export function secToFrame(sec: number, fps: number): number {
  return Math.round(sec * (fps > 0 ? fps : DEFAULT_FPS));
}

/** képkocka-index → mp */
export function frameToSec(frame: number, fps: number): number {
  return frame / (fps > 0 ? fps : DEFAULT_FPS);
}

/**
 * Egy időpont a frame-rácsra kerekítve (a lebegő-hiba ellen a kockára
 * kvantálunk, majd vissza). A vágás/kulcskocka/léptetés ezt használja.
 */
export function snapToFrame(sec: number, fps: number): number {
  const f = fps > 0 ? fps : DEFAULT_FPS;
  return Math.round(sec * f) / f;
}

/**
 * mp → `HH:MM:SS:FF` timecode (non-drop-frame). A FF a másodpercen belüli
 * képkocka (0…fps-1). A pro NLE-k ezt mutatják — kockára pontosan olvasható.
 */
export function formatTimecode(sec: number, fps: number): string {
  const f = fps > 0 ? fps : DEFAULT_FPS;
  const total = Math.max(0, Math.round(sec * f)); // teljes képkockaszám
  const frames = total % f;
  const totalSec = Math.floor(total / f);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p2 = (n: number) => n.toString().padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(frames)}`;
}
