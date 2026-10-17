/**
 * 🧱 timelineMeta-slice — idővonal-metaadat: fejezetek, régiók, markerek,
 * beat-rács, javasolt vágások, pacing/keresés-kiemelés.
 *
 * A projekt-metaadat (chapters/regions/markers) `get().dispatch(...)`-en íródik;
 * a javaslatok/beat/pacing SESSION-szintűek (nem kerülnek a projektbe).
 */
import { t as tr } from 'i18next';

import { makeId } from '@/lib/id';
import { findClip } from '@/lib/projectUtils';
import type { Chapter, ChapterKind, TimelineRegion } from '@/types/project';

import { REGION_COLORS, SESSION_RESET, type EditorState } from '../editorState';
import type { EditorSlice } from './types';

type TimelineMetaSlice = Pick<
  EditorState,
  | 'suggestedCuts'
  | 'pacingInsight'
  | 'searchMatchTimes'
  | 'beatTimes'
  | 'downbeatTimes'
  | 'addChapterAt'
  | 'cycleChapterKind'
  | 'removeChapter'
  | 'applyAiChapters'
  | 'addRegion'
  | 'removeRegion'
  | 'recolorRegion'
  | 'regionFromRange'
  | 'setSuggestedCuts'
  | 'clearSuggestedCuts'
  | 'setPacingInsight'
  | 'setSearchMatchTimes'
  | 'applySuggestedCuts'
  | 'setBeatGrid'
  | 'markersFromBeats'
  | 'cutsFromBeats'
>;

export const createTimelineMetaSlice: EditorSlice<TimelineMetaSlice> = (set, get) => ({
  suggestedCuts: SESSION_RESET.suggestedCuts,
  pacingInsight: SESSION_RESET.pacingInsight,
  searchMatchTimes: SESSION_RESET.searchMatchTimes,
  beatTimes: SESSION_RESET.beatTimes,
  downbeatTimes: SESSION_RESET.downbeatTimes,

  addChapterAt: (kind) => {
    const { project, playhead } = get();
    if (!project) {
      return;
    }
    const start = Math.max(0, Math.round(playhead * 100) / 100);
    // ugyanannál a startnál ne legyen két fejezet — a meglévőt felülírjuk
    const chapters: Chapter[] = [
      ...(project.chapters ?? []).filter((c) => Math.abs(c.start - start) > 0.05),
      { id: makeId('chp'), start, kind },
    ];
    get().dispatch({ type: 'SET_CHAPTERS', chapters });
  },

  cycleChapterKind: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    const order: ChapterKind[] = ['hook', 'context', 'value', 'cta', 'other'];
    const chapters = (project.chapters ?? []).map((c) =>
      c.id === id ? { ...c, kind: order[(order.indexOf(c.kind) + 1) % order.length] } : c
    );
    get().dispatch({ type: 'SET_CHAPTERS', chapters });
  },

  removeChapter: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_CHAPTERS',
      chapters: (project.chapters ?? []).filter((c) => c.id !== id),
    });
  },

  applyAiChapters: (input) => {
    const { project } = get();
    if (!project) {
      return;
    }
    // időrend + közeli dedup, majd id-hozzárendelés — a régi fejezeteket cseréli
    const sorted = [...input].sort((a, b) => a.start - b.start);
    const chapters: Chapter[] = [];
    for (const c of sorted) {
      if (!chapters.some((d) => Math.abs(d.start - c.start) < 0.05)) {
        chapters.push({ id: makeId('chp'), start: Math.max(0, c.start), kind: c.kind });
      }
    }
    // provenance: az esemény-naplóban 'ai'-ként jelenik meg (mint az AI-parancsok)
    get().dispatch({ type: 'SET_CHAPTERS', chapters }, 'ai');
  },

  addRegion: () => {
    const { project, selectedClipId, playhead } = get();
    if (!project) {
      return;
    }
    // a kijelölt klip tartománya, vagy alap 3 mp-es sáv a lejátszófejnél
    let start = Math.max(0, playhead);
    let end = start + 3;
    if (selectedClipId) {
      const c = findClip(project, selectedClipId)?.clip;
      if (c) {
        start = c.start;
        end = c.start + c.duration;
      }
    }
    const regions = project.regions ?? [];
    const region: TimelineRegion = {
      id: makeId('rgn'),
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      label: tr('store.editor.regionDefault', { n: regions.length + 1 }),
      color: REGION_COLORS[regions.length % REGION_COLORS.length],
    };
    get().dispatch({ type: 'SET_REGIONS', regions: [...regions, region] });
  },

  removeRegion: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_REGIONS',
      regions: (project.regions ?? []).filter((r) => r.id !== id),
    });
  },

  recolorRegion: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_REGIONS',
      regions: (project.regions ?? []).map((r) =>
        r.id === id
          ? { ...r, color: REGION_COLORS[(REGION_COLORS.indexOf(r.color) + 1) % REGION_COLORS.length] }
          : r
      ),
    });
  },

  regionFromRange: () => {
    const { project, rangeIn, rangeOut } = get();
    if (!project || rangeIn == null || rangeOut == null || rangeOut - rangeIn < 0.05) {
      return;
    }
    const regions = project.regions ?? [];
    const region: TimelineRegion = {
      id: makeId('rgn'),
      start: rangeIn,
      end: rangeOut,
      label: tr('store.editor.regionDefault', { n: regions.length + 1 }),
      color: REGION_COLORS[regions.length % REGION_COLORS.length],
    };
    if (get().dispatch({ type: 'SET_REGIONS', regions: [...regions, region] })) {
      set({ rangeIn: null, rangeOut: null });
    }
  },

  setSuggestedCuts: (times) =>
    set({ suggestedCuts: [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b) }),

  clearSuggestedCuts: () => set({ suggestedCuts: [] }),

  setPacingInsight: (insight) => set({ pacingInsight: insight }),

  setSearchMatchTimes: (times) =>
    set({ searchMatchTimes: [...times].sort((a, b) => a - b) }),

  applySuggestedCuts: () => {
    const times = [...get().suggestedCuts].sort((a, b) => a - b);
    for (const t of times) {
      // minden vágásnál újraolvassuk a projektet (a split megváltoztatja a klipeket)
      const project = get().project;
      const videoTrack = project?.tracks.find((tk) => tk.type === 'video');
      const clip = videoTrack?.clips.find((c) => c.start + 0.05 < t && t < c.start + c.duration - 0.05);
      if (clip) {
        get().splitClipAt(clip.id, t);
      }
    }
    set({ suggestedCuts: [] });
  },

  setBeatGrid: (beatTimes, downbeatTimes) => set({ beatTimes, downbeatTimes }),

  markersFromBeats: (mode) => {
    const { project, beatTimes, downbeatTimes } = get();
    if (!project) {
      return 0;
    }
    const times = mode === 'downbeat' ? downbeatTimes : beatTimes;
    if (times.length === 0) {
      return 0;
    }
    const markers = [...(project.markers ?? [])];
    let added = 0;
    for (const time of times) {
      const t2 = Math.round(time * 100) / 100;
      // már meglévő jelölő közelébe (±0.05 mp) ne tegyünk másikat
      if (markers.some((m) => Math.abs(m.time - t2) < 0.05)) {
        continue;
      }
      markers.push({ id: makeId('mk'), time: t2, label: tr('store.editor.beatMarker'), color: '#4a9eff' });
      added += 1;
    }
    if (added === 0) {
      return 0;
    }
    get().dispatch({ type: 'SET_MARKERS', markers });
    return added;
  },

  cutsFromBeats: (mode) => {
    const { beatTimes, downbeatTimes } = get();
    const times = mode === 'downbeat' ? downbeatTimes : beatTimes;
    // nem-destruktív: szaggatott jelölés; a felhasználó az applySuggestedCuts-tal alkalmazza
    get().setSuggestedCuts(times);
    return times.length;
  },
});
