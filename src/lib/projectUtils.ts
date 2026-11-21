// Barrel — a tiszta (expo-mentes) projekt-modell a projectModel/ alatt: sávok + fogadási szabályok,
// létrehozás + fajta/útvonal, tokenek, séma-migráció, lekérdezések + hossz, playhead-keresők,
// klip-vágás/trim, uri-átírás. A belső segédek (CANONICAL_TRACKS, migrateTo*) nem publikusak.
export { canHostClip, compatibleTracksFor } from '@/lib/projectModel/tracks';
export {
  createEmptyProject,
  projectKind,
  studioRoute,
  type CreateProjectConfig,
} from '@/lib/projectModel/create';
export { parseHashtags, parseKeywords } from '@/lib/projectModel/tokens';
export { CURRENT_SCHEMA_VERSION, isNewerSchema, migrateProject } from '@/lib/projectModel/schema';
export {
  clipEnd,
  exceedsMaxDuration,
  findAssetByUri,
  findClip,
  isProjectEmpty,
  MAX_PROJECT_DURATION_SEC,
  projectDuration,
  projectMediaBytes,
  trackEnd,
  trackOf,
} from '@/lib/projectModel/queries';
export {
  activeAdjustClips,
  activePipClip,
  activePipClips,
  activeTransition,
  activeVisualClip,
  clipsAt,
  sourceTimeAt,
  upcomingVisualClip,
  type ActiveTransition,
} from '@/lib/projectModel/playhead';
export {
  cropClip,
  loopPhase,
  maxVideoDuration,
  splitClip,
  trimClipLeft,
  trimClipRight,
} from '@/lib/projectModel/clipEdit';
export { relinkUri, replaceClip } from '@/lib/projectModel/rewrite';
