import type { PacingInsight } from '@/lib/pacingClient';
import type { TrackType } from '@/types/project';
import {
  DEFAULT_SNAP_TARGETS,
  type InsightLane,
  type SnapStrength,
  type TrimMode,
} from '@/store/editorStateParts/editorConstants';

/**
 * Az ÁTMENETI szerkesztő-módok alaphelyzete. Projekt betöltésekor ÉS
 * bezárásakor UGYANEZT kell nullázni — a lista két helyre másolása már kétszer
 * okozott beragadt módot (a zárolás/rajzoló-mód átragadt a következő
 * projektre), ezért közös konstans.
 *
 * A `styleClipboard` SZÁNDÉKOSAN nincs benne: a másolt megjelenés projektek
 * közt is átvihető.
 */
export const SESSION_RESET = {
  multiSelectIds: [] as string[],
  multiSelectMode: false,
  drawBrush: null,
  drawMaskMode: false,
  rippleMode: false,
  razorMode: false,
  trimMode: 'normal' as TrimMode,
  snapGrid: 0,
  snapStrength: 'normal' as SnapStrength,
  snapTargets: { ...DEFAULT_SNAP_TARGETS },
  hiddenTracks: [] as TrackType[],
  autoTrackHeight: false,
  playbackRate: 1,
  playThrough: false,
  rangeIn: null as number | null,
  rangeOut: null as number | null,
  showSafeZones: false,
  focusMode: false,
  comparingOriginal: false,
  compareSplit: null as number | null,
  masterVolume: 1,
  insightLane: 'story' as InsightLane,
  maskEdit: false,
  rotoMask: false,
  videoVoiceActive: false,
  mutedTracks: [] as TrackType[],
  soloTracks: [] as TrackType[],
  lockedTracks: [] as TrackType[],
  fxBypass: false,
  collapsedTracks: [] as TrackType[],
  trackHeightScale: {} as Partial<Record<TrackType, number>>,
  suggestedCuts: [] as number[],
  pacingInsight: null as PacingInsight | null,
  searchMatchTimes: [] as number[],
  beatTimes: [] as number[],
  downbeatTimes: [] as number[],
  variantPreview: null,
  pickTarget: null,
};
