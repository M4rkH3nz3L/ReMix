/**
 * 🧱 view-slice — SESSION-szintű nézet- és szerkesztő-mód állapot: zoom, aktív
 * panel, trim/ripple/razor/draw-módok, snap-beállítások, sáv-kapcsolók
 * (mute/solo/lock/collapse/hidden + magasság), proxy, és a Kép/Hang Stúdió cél-klip.
 *
 * Ez NEM projekt-adat → nem kerül a history-ba/exportba. (A `proxyEnabled`/
 * `proxyQuality` szándékosan NEM session-reset: projektváltáskor is megmarad.)
 */
import { MAX_ZOOM, MIN_ZOOM } from '@/constants/editor';
import { videoPanelSpec } from '@/lib/panelSpecs';
import { setProxyConfig } from '@/lib/proxy';
import { findClip } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import type { TrackType } from '@/types/project';

import {
  PROXY_MAX_SIDE,
  SESSION_RESET,
  TRIM_MODES,
  type EditorState,
  type TrackFlagKey,
} from '../editorState';
import type { EditorSlice } from './types';

type ViewSlice = Pick<
  EditorState,
  | 'zoom'
  | 'activePanel'
  | 'panelDetent'
  | 'panelExpanded'
  | 'panelDetentMemory'
  | 'trimMode'
  | 'rippleMode'
  | 'razorMode'
  | 'snapGrid'
  | 'snapStrength'
  | 'snapTargets'
  | 'drawBrush'
  | 'drawMaskMode'
  | 'focusMode'
  | 'comparingOriginal'
  | 'compareSplit'
  | 'insightLane'
  | 'maskEdit'
  | 'rotoMask'
  | 'showSafeZones'
  | 'mutedTracks'
  | 'soloTracks'
  | 'lockedTracks'
  | 'collapsedTracks'
  | 'hiddenTracks'
  | 'autoTrackHeight'
  | 'trackHeightScale'
  | 'proxyEnabled'
  | 'proxyQuality'
  | 'imageStudioClipId'
  | 'audioStudioClipId'
  | 'setRippleMode'
  | 'setRazorMode'
  | 'toggleRazorMode'
  | 'setTrimMode'
  | 'cycleTrimMode'
  | 'setDrawBrush'
  | 'setDrawMaskMode'
  | 'setSnapGrid'
  | 'setProxyEnabled'
  | 'setProxyQuality'
  | 'toggleSafeZones'
  | 'cycleSnapStrength'
  | 'toggleSnapTarget'
  | 'toggleFocusMode'
  | 'setComparingOriginal'
  | 'setCompareSplit'
  | 'setInsightLane'
  | 'setMaskEdit'
  | 'setRotoMask'
  | 'setZoom'
  | 'setPanel'
  | 'setPanelDetent'
  | 'expandPanel'
  | 'toggleTrackFlag'
  | 'cycleTrackHeight'
  | 'isTrackVisible'
  | 'toggleAutoTrackHeight'
  | 'isTrackAudible'
  | 'openImageStudio'
  | 'closeImageStudio'
  | 'openAudioStudio'
  | 'closeAudioStudio'
>;

export const createViewSlice: EditorSlice<ViewSlice> = (set, get) => ({
  zoom: 1,
  activePanel: null,
  panelDetent: 'peek',
  panelExpanded: false,
  panelDetentMemory: {},
  imageStudioClipId: null,
  audioStudioClipId: null,
  // 🎯 teljesítmény: NEM session-reset, hogy projektváltáskor is megmaradjon
  proxyEnabled: true,
  proxyQuality: 'medium',
  trimMode: SESSION_RESET.trimMode,
  rippleMode: SESSION_RESET.rippleMode,
  razorMode: SESSION_RESET.razorMode,
  snapGrid: SESSION_RESET.snapGrid,
  snapStrength: SESSION_RESET.snapStrength,
  snapTargets: SESSION_RESET.snapTargets,
  drawBrush: SESSION_RESET.drawBrush,
  drawMaskMode: SESSION_RESET.drawMaskMode,
  focusMode: SESSION_RESET.focusMode,
  comparingOriginal: SESSION_RESET.comparingOriginal,
  compareSplit: SESSION_RESET.compareSplit,
  insightLane: SESSION_RESET.insightLane,
  maskEdit: SESSION_RESET.maskEdit,
  rotoMask: SESSION_RESET.rotoMask,
  showSafeZones: SESSION_RESET.showSafeZones,
  mutedTracks: SESSION_RESET.mutedTracks,
  soloTracks: SESSION_RESET.soloTracks,
  lockedTracks: SESSION_RESET.lockedTracks,
  collapsedTracks: SESSION_RESET.collapsedTracks,
  hiddenTracks: SESSION_RESET.hiddenTracks,
  autoTrackHeight: SESSION_RESET.autoTrackHeight,
  trackHeightScale: SESSION_RESET.trackHeightScale,

  toggleTrackFlag: (type, flag) => {
    const key =
      flag === 'mute'
        ? 'mutedTracks'
        : flag === 'solo'
          ? 'soloTracks'
          : flag === 'collapse'
            ? 'collapsedTracks'
            : flag === 'hidden'
              ? 'hiddenTracks'
              : 'lockedTracks';
    const list: TrackType[] = get()[key];
    const next = list.includes(type) ? list.filter((t) => t !== type) : [...list, type];
    // zároláskor a sávon lévő kijelölés elévül (különben zárolt klipet
    // szerkesztenének a panelek)
    if (flag === 'lock' && !list.includes(type)) {
      const { project, selectedClipId } = get();
      const sel = project && selectedClipId ? findClip(project, selectedClipId) : null;
      if (sel?.track.type === type) {
        set({ selectedClipId: null, multiSelectIds: [], multiSelectMode: false, activePanel: null });
      }
    }
    // a számított kulcs miatt kellett korábban `as never`: TS a
    // `{ [key]: érték }` alakból index-szignatúrát képez. Egy célzottan szűkített
    // patch-objektumon viszont a hozzárendelés típus-helyes, assertion nélkül —
    // mind az öt kulcs `TrackType[]`-et tárol.
    const patch: Partial<Pick<EditorState, TrackFlagKey>> = {};
    patch[key] = next;
    set(patch);
  },

  cycleTrackHeight: (type) => {
    const steps = [1, 1.6, 2.4];
    const cur = get().trackHeightScale[type] ?? 1;
    const idx = steps.indexOf(cur);
    const next = steps[(idx + 1) % steps.length] ?? 1;
    // kézi léptetés kikapcsolja az automatikus magasságot (a user átvette az irányítást)
    set((s) => ({ autoTrackHeight: false, trackHeightScale: { ...s.trackHeightScale, [type]: next } }));
  },

  isTrackVisible: (type) => !get().hiddenTracks.includes(type),

  toggleAutoTrackHeight: () => set((s) => ({ autoTrackHeight: !s.autoTrackHeight })),

  setRippleMode: (on) => set({ rippleMode: on }),

  // borotva és rajzoló-mód kizárja egymást (mindkettő a vászon/idővonal koppintását foglalja)
  setRazorMode: (on) => set(on ? { razorMode: true, drawBrush: null } : { razorMode: false }),
  toggleRazorMode: () => set((s) => (s.razorMode ? { razorMode: false } : { razorMode: true, drawBrush: null })),

  setTrimMode: (mode) => set({ trimMode: mode }),
  cycleTrimMode: () =>
    set((s) => ({ trimMode: TRIM_MODES[(TRIM_MODES.indexOf(s.trimMode) + 1) % TRIM_MODES.length] })),

  setDrawBrush: (brush) => set(brush ? { drawBrush: brush, drawMaskMode: false } : { drawBrush: brush }),

  setProxyEnabled: (on) => {
    setProxyConfig({ enabled: on });
    set({ proxyEnabled: on });
  },
  setProxyQuality: (q) => {
    setProxyConfig({ maxSide: PROXY_MAX_SIDE[q] });
    set({ proxyQuality: q });
  },

  // szabadkézi maszk kizárja a forma-rajzolót és a borotvát (mind a vászon/idővonal koppintását foglalja)
  setDrawMaskMode: (on) =>
    set(on ? { drawMaskMode: true, drawBrush: null, razorMode: false } : { drawMaskMode: false }),

  setSnapGrid: (grid) => set({ snapGrid: grid }),
  toggleSafeZones: () => set((s) => ({ showSafeZones: !s.showSafeZones })),

  cycleSnapStrength: () =>
    set((s) => ({
      snapStrength:
        s.snapStrength === 'normal' ? 'strong' : s.snapStrength === 'strong' ? 'off' : 'normal',
    })),
  toggleSnapTarget: (key) =>
    set((s) => ({ snapTargets: { ...s.snapTargets, [key]: !s.snapTargets[key] } })),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setComparingOriginal: (on) => set({ comparingOriginal: on }),
  setCompareSplit: (v) => set({ compareSplit: v }),
  setInsightLane: (lane) => set({ insightLane: lane }),

  setMaskEdit: (on) => set({ maskEdit: on }),

  setRotoMask: (on) => set(on ? { rotoMask: true, maskEdit: true } : { rotoMask: false }),

  isTrackAudible: (type) => {
    const { mutedTracks, soloTracks } = get();
    // ha bármi solóban van, CSAK az szól — ez a szokásos keverőpult-logika
    return soloTracks.length > 0 ? soloTracks.includes(type) : !mutedTracks.includes(type);
  },

  setZoom: (zoom) => set({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }),

  // 📐 panel-nyitáskor a detent a felhasználó utolsó választása (ha volt), különben a
  // regiszter kezdő detentje; a Strip-panelek összecsukva (strip-szinten) nyílnak.
  // (A Focus-szint NEM tárolt flag: a `selectSurfaceTier` a regiszterből számolja,
  // így nem ragadhat be, ha egy másik slice nullázza az activePanel-t.)
  setPanel: (panel) =>
    set((s) => {
      if (!panel) {
        return { activePanel: null, panelExpanded: false };
      }
      const spec = videoPanelSpec(panel);
      return {
        activePanel: panel,
        panelExpanded: false,
        panelDetent: s.panelDetentMemory[panel] ?? spec?.initialDetent ?? 'peek',
      };
    }),
  setPanelDetent: (detent) =>
    set((s) => ({
      panelDetent: detent,
      panelDetentMemory: s.activePanel
        ? { ...s.panelDetentMemory, [s.activePanel]: detent }
        : s.panelDetentMemory,
    })),
  expandPanel: () =>
    set((s) => {
      if (!s.activePanel) {
        return {};
      }
      const spec = videoPanelSpec(s.activePanel);
      return {
        panelExpanded: true,
        panelDetent: s.panelDetentMemory[s.activePanel] ?? spec?.initialDetent ?? 'half',
      };
    }),

  openImageStudio: (clipId) => set({ imageStudioClipId: clipId }),
  closeImageStudio: () => set({ imageStudioClipId: null }),

  openAudioStudio: (clipId) => set({ audioStudioClipId: clipId }),
  closeAudioStudio: () => set({ audioStudioClipId: null }),
});
