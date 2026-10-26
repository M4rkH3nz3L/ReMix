import {
  DEFAULT_SNAP_TARGETS,
  PROXY_MAX_SIDE,
  SNAP_FACTOR,
  TRIM_MODES,
  selectPanelVisible,
  selectSelectedClip,
  setLiveBroadcaster,
  setLockBroadcaster,
  useEditorStore,
} from '@/store/editorStore';
import type { Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🧱 Health §01 — a slice-ozott store PUBLIKUS SZERZŐDÉSE (drift-pajzs).
 *
 * MIÉRT: az `editorStore` felelősség-alapú zustand-slice-okra bomlott
 * (history/selection/clipEdit/timelineMeta/collab/playback/view). Ez a teszt
 * rögzíti, hogy a felosztás NEM ejtett el / nevezett át publikus mezőt vagy
 * metódust, a `@/store/editorStore` re-exportok megvannak, és az undo
 * granularitása változatlan (egy szerkesztés = egy history-lépés).
 */

function videoClip(id: string, start = 0, duration = 5): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri: `file:///clip-${id}.mp4`, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}
function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}
function makeProject(tracks: Track[]): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks, assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
afterEach(() => store().closeProject());

// A teljes publikus metódus-felület — minden slice-ból. Ha egy slice-mozgatás
// elejt vagy átnevez egy metódust, az itt FÜGGVÉNY-hiányként bukik.
const METHOD_KEYS = [
  // history
  'loadProject', 'restoreProject', 'closeProject', 'dispatch', 'applyBatch',
  'undo', 'redo', 'jumpHistory', 'markSaved', 'setRendered',
  // selection
  'selectClip', 'toggleMultiSelect', 'selectClips', 'setMultiSelectMode', 'allSelectedIds',
  'copyStyle', 'pasteStyle', 'copyClips', 'cutClips', 'pasteClipsAt', 'canPasteTo',
  // clipEdit
  'addClip', 'insertSourceAsset', 'updateClip', 'removeClip', 'splitClipAt',
  'moveClip', 'moveSelectedClipToNextTrack', 'moveClipByTrackStep',
  'nudgeClipsBy', 'nudgeSelectedBy', 'linkGroupOf', 'linkSelected', 'preCompose', 'unlinkClip',
  'rippleDelete', 'rippleResize', 'closeGapBefore', 'deleteRange',
  'rollEdit', 'slipEdit', 'slideEdit',
  // timelineMeta
  'addChapterAt', 'cycleChapterKind', 'removeChapter', 'applyAiChapters',
  'addRegion', 'removeRegion', 'recolorRegion', 'regionFromRange',
  'setSuggestedCuts', 'clearSuggestedCuts', 'setPacingInsight', 'setSearchMatchTimes',
  'applySuggestedCuts', 'setBeatGrid', 'markersFromBeats', 'cutsFromBeats',
  // collab
  'setCollabSelf', 'applyRemoteLock', 'acquireClipLock', 'releaseClipLock', 'pruneClipLocks', 'canEditClip',
  // playback
  'setPlayhead', 'setPlaying', 'setLoop', 'setPlaybackRate', 'shuttle',
  'setRangeIn', 'setRangeOut', 'clearRange', 'setMasterVolume', 'setVideoVoiceActive',
  'setVariantPreview', 'setPickTarget',
  // view
  'setRippleMode', 'setRazorMode', 'toggleRazorMode', 'setTrimMode', 'cycleTrimMode',
  'setDrawBrush', 'setDrawMaskMode', 'setSnapGrid', 'setProxyEnabled', 'setProxyQuality',
  'toggleSafeZones', 'cycleSnapStrength', 'toggleSnapTarget', 'toggleFocusMode',
  'setComparingOriginal', 'setCompareSplit', 'setInsightLane', 'setMaskEdit', 'setRotoMask',
  'setZoom', 'setPanel', 'toggleTrackFlag', 'cycleTrackHeight', 'isTrackVisible',
  'toggleAutoTrackHeight', 'isTrackAudible', 'openImageStudio', 'closeImageStudio',
  'openAudioStudio', 'closeAudioStudio', 'setPanelDetent', 'expandPanel',
] as const;

const STATE_KEYS = [
  'project', 'selectedClipId', 'clipLocks', 'collabSelf', 'multiSelectIds', 'multiSelectMode',
  'styleClipboard', 'clipClipboard', 'mutedTracks', 'soloTracks', 'lockedTracks', 'collapsedTracks',
  'trackHeightScale', 'suggestedCuts', 'pacingInsight', 'searchMatchTimes', 'rippleMode', 'drawBrush',
  'drawMaskMode', 'snapGrid', 'snapStrength', 'snapTargets', 'razorMode', 'trimMode', 'hiddenTracks',
  'autoTrackHeight', 'playbackRate', 'rangeIn', 'rangeOut', 'showSafeZones', 'focusMode',
  'comparingOriginal', 'compareSplit', 'masterVolume', 'insightLane', 'maskEdit', 'rotoMask',
  'videoVoiceActive', 'playhead', 'isPlaying', 'loop', 'beatTimes', 'downbeatTimes', 'variantPreview',
  'pickTarget', 'zoom', 'activePanel', 'past', 'future', 'pastLabels', 'futureLabels', 'dirty', 'events',
  'proxyEnabled', 'proxyQuality', 'imageStudioClipId', 'audioStudioClipId',
  'panelDetent', 'panelExpanded', 'panelDetentMemory',
] as const;

describe('publikus szerződés (slice-drift pajzs)', () => {
  it('minden metódus FÜGGVÉNYként elérhető a store-on', () => {
    const s = store() as unknown as Record<string, unknown>;
    for (const key of METHOD_KEYS) {
      expect(typeof s[key]).toBe('function');
    }
  });

  it('minden állapot-mező JELEN van a store-on (az init-érték beleértve)', () => {
    const s = store() as unknown as Record<string, unknown>;
    for (const key of STATE_KEYS) {
      expect(key in s).toBe(true);
    }
  });

  it('a @/store/editorStore re-exportok megvannak (konstansok + setterek + selectorok)', () => {
    expect(SNAP_FACTOR).toEqual({ off: 0, normal: 1, strong: 2 });
    expect(PROXY_MAX_SIDE.medium).toBe(960);
    expect(TRIM_MODES).toContain('slip');
    expect(DEFAULT_SNAP_TARGETS.playhead).toBe(true);
    expect(typeof setLiveBroadcaster).toBe('function');
    expect(typeof setLockBroadcaster).toBe('function');
    expect(typeof selectSelectedClip).toBe('function');
    expect(typeof selectPanelVisible).toBe('function');
  });
});

describe('slice-kompozíció (minden felelősségi kör él)', () => {
  it('init-állapot a hét slice mezőivel (history/selection/playback/view/…)', () => {
    const s = store();
    expect(s.project).toBeNull();        // history
    expect(s.selectedClipId).toBeNull(); // selection
    expect(s.playhead).toBe(0);          // playback
    expect(s.zoom).toBe(1);              // view
    expect(s.trimMode).toBe('normal');   // view (SESSION_RESET)
    expect(s.clipLocks).toEqual({});     // collab
    expect(s.suggestedCuts).toEqual([]); // timelineMeta
    expect(s.proxyEnabled).toBe(true);   // view (NEM session-reset)
  });

  it('cross-slice hívás: a clipEdit-facade a history-dispatch-en át ír', () => {
    store().loadProject(makeProject([track('video', [videoClip('c1')])]));
    store().selectClip('c1');
    store().updateClip('c1', { volume: 0.5 });
    const clip = store().project!.tracks[0].clips[0] as VideoClip;
    expect(clip.volume).toBe(0.5);
  });
});

describe('undo-granularitás (egy szerkesztés = egy history-lépés)', () => {
  it('updateClip → pontosan egy past-lépés; undo visszaállít', () => {
    store().loadProject(makeProject([track('video', [videoClip('c1')])]));
    expect(store().past).toHaveLength(0);
    store().selectClip('c1');
    store().updateClip('c1', { volume: 0.25 });
    expect(store().past).toHaveLength(1);
    expect(store().dirty).toBe(true);
    store().undo();
    expect(store().past).toHaveLength(0);
    expect((store().project!.tracks[0].clips[0] as VideoClip).volume).toBe(1);
  });

  it('applyBatch (több command) = EGY undo-lépés', () => {
    store().loadProject(makeProject([track('text')]));
    const n = store().applyBatch([
      { type: 'ADD_CLIP', trackType: 'text', clip: { id: 't1', kind: 'text', start: 0, duration: 3, text: 'a', color: '#fff', backgroundColor: null, fontSize: 7, fontWeight: 'normal', position: { x: 0.5, y: 0.5 }, animation: 'none' } },
      { type: 'ADD_CLIP', trackType: 'text', clip: { id: 't2', kind: 'text', start: 3, duration: 3, text: 'b', color: '#fff', backgroundColor: null, fontSize: 7, fontWeight: 'normal', position: { x: 0.5, y: 0.5 }, animation: 'none' } },
    ]);
    expect(n).toBe(2);
    expect(store().past).toHaveLength(1); // két command, EGY undo-lépés
    store().undo();
    expect(store().project!.tracks[0].clips).toHaveLength(0);
  });
});
