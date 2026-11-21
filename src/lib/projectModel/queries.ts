import type { Asset, Clip, Project, Track, TrackType } from '@/types/project';

export function findAssetByUri(project: Project, uri: string): Asset | null {
  return project.assets.find((a) => a.uri === uri) ?? null;
}

/**
 * A projekt média-asseteinek ISMERT bájt-összege (uri szerint deduplikálva). Csak a
 * betöltött `asset.size`-okat összegzi (ezt a szerver-backup tölti fel a mért
 * bájttal) — kliens-oldali BECSLÉS. A hiteles, pontos per-projekt tárhely (amit a MI
 * tárolónkon foglal) a `projectStorageBytes(projectId)` a `@/lib/storageQuota`-ból.
 */
export function projectMediaBytes(project: Project): number {
  const seen = new Set<string>();
  let total = 0;
  for (const a of project.assets) {
    if (seen.has(a.uri)) {
      continue;
    }
    seen.add(a.uri);
    total += a.size ?? 0;
  }
  return total;
}

export function trackOf(project: Project, type: TrackType): Track {
  const found = project.tracks.find((t) => t.type === type);
  if (!found) {
    throw new Error(`Hiányzó sáv: ${type}`);
  }
  return found;
}

export function findClip(
  project: Project,
  clipId: string
): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) {
      return { track, clip };
    }
  }
  return null;
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function trackEnd(track: Track): number {
  return track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/**
 * A projekt teljes hossza (a leghosszabb sáv vége).
 *
 * ⚡ MEMOIZÁLVA a projekt-objektum IDENTITÁSÁRA. Ez a függvény a legforróbb
 * útvonalon fut: a `TransportBar` zustand-selectorában (tehát MINDEN store-
 * `set`-nél), a rAF-óra minden tickjében, a `setPlayhead` clampjében és a
 * `Timeline` minden renderjében — lejátszás közben ez percenként több ezer
 * teljes klip-bejárást jelentene.
 *
 * A cache azért helyes, mert a szerkesztés KIZÁRÓLAG a command buson megy
 * (`applyCommand`), ami spread-alapú, immutábilis: bármilyen változás ÚJ
 * projekt-objektumot ad, tehát új cache-bejegyzést. Helyben mutáló írás
 * elavult értéket adna — ilyen a kódbázisban nincs (az audit 0 megkerülést
 * talált), és a `WeakMap` miatt a régi projektek szabadon felszabadulnak.
 */
const durationCache = new WeakMap<Project, number>();

export function projectDuration(project: Project): number {
  const hit = durationCache.get(project);
  if (hit !== undefined) {
    return hit;
  }
  const value = project.tracks.reduce((max, t) => Math.max(max, trackEnd(t)), 0);
  durationCache.set(project, value);
  return value;
}

/**
 * 🎬 A videó MAX hossza — 10 perc (short-video scope, [SCOPES.md](../../devs/tasks/SCOPES.md)).
 * Globális felső határ (a TikTok-plafonnal is egyezik); a szerver-render ezt HARD-ENFORCE-olja
 * ([server/render.js](../../server/render.js) `MAX_RENDER_DURATION_SEC` — contract-tesztelt tükör),
 * a kliens pedig ebből figyelmeztet/gátol a timeline-on. (Tier-szinten szigoríthatóbb, feljebb nem.)
 */
export const MAX_PROJECT_DURATION_SEC = 600;

/** Túllépi-e a projekt a max hosszt (soft-warn/UX-gate forrása)? */
export function exceedsMaxDuration(project: Project): boolean {
  return projectDuration(project) > MAX_PROJECT_DURATION_SEC;
}

/**
 * Üres-e a projekt (egyetlen klip sincs egyetlen sávon sem).
 * A szerkesztő ebből dönti el, hogy a fekete vászon helyett onboardingot
 * mutasson, ami a forrás-binhez vezet (EDITOR-UX §2.5).
 */
export function isProjectEmpty(project: Project): boolean {
  return project.tracks.every((t) => t.clips.length === 0);
}
