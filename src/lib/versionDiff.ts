import { projectDuration } from '@/lib/projectUtils';
import type { Project } from '@/types/project';

/**
 * 🔍 Két projekt-verzió összehasonlítása. `a` = a régebbi (pl. egy pillanatkép),
 * `b` = az újabb (pl. az aktuális projekt). A klipeket AZONOSÍTÓ szerint veti
 * össze: `added` = `b`-ben új, `removed` = `b`-ből hiányzó, `changed` = azonos id
 * de eltérő tartalom. Pure, tesztelhető.
 */
export interface VersionDiff {
  durationA: number;
  durationB: number;
  clipsA: number;
  clipsB: number;
  added: number;
  removed: number;
  changed: number;
}

export function compareProjects(a: Project, b: Project): VersionDiff {
  const clipMap = (p: Project) =>
    new Map(p.tracks.flatMap((t) => t.clips).map((c) => [c.id, c]));
  const ma = clipMap(a);
  const mb = clipMap(b);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, clip] of mb) {
    const prev = ma.get(id);
    if (!prev) {
      added += 1;
    } else if (JSON.stringify(prev) !== JSON.stringify(clip)) {
      changed += 1;
    }
  }
  for (const id of ma.keys()) {
    if (!mb.has(id)) {
      removed += 1;
    }
  }
  return {
    durationA: Math.round(projectDuration(a) * 10) / 10,
    durationB: Math.round(projectDuration(b) * 10) / 10,
    clipsA: ma.size,
    clipsB: mb.size,
    added,
    removed,
    changed,
  };
}
