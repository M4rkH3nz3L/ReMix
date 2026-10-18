import { applyCommand } from '@/lib/commands';
import { snapToFrame } from '@/lib/frames';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AspectRatio, Project, VideoClip } from '@/types/project';

/**
 * 📼→🎬 Live-felvétel (VOD) → szerkeszthető `kind:'video'` projekt (LIVE/05.1).
 *
 * Az adás végén, ha a host RÖGZÍTETT és van felvett VOD-URL (`liveEndDisposition`
 * === 'import-vod'), a nyers felvételből EGY videó-projekt készül: a VOD a fő
 * videosávon lévő egyetlen klip, így a Video Studio tovább vágható/effektezhető.
 *
 * Pure, expo-mentes, önmagában tesztelhető (lásd AGENTS.md): az id-generátort és
 * az fps-t INJEKTÁLJUK. A klip a projektbe a COMMAND-BUSON (`applyCommand`,
 * `ADD_CLIP`) kerül — SOHA nem írjuk közvetlenül a projektet —, így az undo már az
 * első művelettől él. Idő másodpercben; a klip a frame-rácsra ül (`snapToFrame`).
 */

/** Opciók a VOD-klip/projekt építéséhez. */
export interface BuildVodOptions {
  /** a felvétel publikus URL-je (az egress S3/R2-be rögzített MP4-je). */
  vodUrl: string;
  /** a felvétel BECSÜLT hossza mp-ben (ld. lenn — az élő eltelt idő). */
  durationSec: number;
  /** a cél-projekt frame-rátája (a klip/hossz erre a rácsra ül). */
  fps: number;
  /** egyedi klip-id generátor (determinisztikus tesztekhez injektálva). */
  makeId: () => string;
}

/**
 * Egy frame-helyes VideoClip a VOD-ból, a fő videosáv elejére (start=0).
 *
 * ⚠️ A `durationSec` BECSLÉS: a felvétel tényleges hosszát az adás végén még nem
 * ismerjük (az egress aszinkron zárul), ezért az élő adás eltelt idejét adjuk át.
 * A Video Studio a videó betöltésekor (a valós metaadatból) pontosítja a hosszt.
 * A mezők a forrás-import klip-építőjével (`buildSourceClip`) egyeznek.
 */
export function buildVodClip(opts: BuildVodOptions): VideoClip {
  const dur = snapToFrame(Math.max(opts.durationSec, 0), opts.fps);
  // legalább 1 képkocka hosszú legyen (0 hosszú klip nincs)
  const duration = dur > 0 ? dur : snapToFrame(1 / Math.max(opts.fps, 1), opts.fps);
  return {
    kind: 'video',
    id: opts.makeId(),
    start: 0,
    duration,
    uri: opts.vodUrl,
    // ⏳ az adás végén az egress MÉG tölti fel a VOD-ot az R2-be → az editor loadert
    //    mutat, amíg a `uri` elérhető nem lesz, majd törli ezt a flaget (UPDATE_CLIP).
    pending: true,
    trimIn: 0,
    sourceDuration: duration,
    speed: 1,
    volume: 1,
    filterId: 'none',
  };
}

/**
 * A VOD-ból szerkeszthető `kind:'video'` projekt: egy üres video-projekt +
 * a VOD-klip a fő videosávon (ADD_CLIP a command-buson). A projekt-id-t a
 * `createEmptyProject` generálja (a hívó ezt kapja vissza a navigációhoz).
 */
export function buildVodProject(opts: BuildVodOptions & { name: string; aspectRatio?: AspectRatio }): Project {
  const base = createEmptyProject(opts.name.trim() || 'Live felvétel', opts.aspectRatio ?? '16:9', undefined, 'video');
  // a klip a projekt fps-ére üljön (a createEmptyProject 30-at ad)
  const fps = typeof base.fps === 'number' && base.fps > 0 ? base.fps : opts.fps;
  const clip = buildVodClip({ ...opts, fps });
  // ⬇️ a klip a COMMAND-BUSON kerül a projektbe (undo innen indul); a reducer
  //    sosem ad null-t itt (létező `video` sáv + érvényes klip) — de óvatos fallback.
  const next = applyCommand(base, { type: 'ADD_CLIP', trackType: 'video', clip });
  return next ?? base;
}
