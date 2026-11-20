/**
 * 📋 Az idővonal Alert-alapú menüi (sáv / illesztés / tartomány / jelölő / régió).
 * A `Timeline.tsx`-ből kiemelve; a render-beli állapotot paraméterként kapják.
 */
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { nextMarkerColor } from '@/components/editor/TransportBar';
import { trackLabels } from '@/constants/editor';
import { AUDIBLE_TRACKS, VISUAL_TRACKS } from '@/lib/timelineLayout';
import { useEditorStore } from '@/store/editorStore';
import type { EditorState, SnapTargets } from '@/store/editorState';
import type { TrackType } from '@/types/project';

type MenuButton = { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' };

/** a sáv-menü bemenetei: a sáv-jelzők + a kapcsoló store-akciók */
export type TrackMenuState = Pick<
  EditorState,
  | 'mutedTracks'
  | 'soloTracks'
  | 'lockedTracks'
  | 'collapsedTracks'
  | 'hiddenTracks'
  | 'autoTrackHeight'
  | 'toggleTrackFlag'
  | 'cycleTrackHeight'
  | 'toggleAutoTrackHeight'
>;

/**
 * Telefonon nincs fejléc-oszlop, ezért a lebegő sáv-címke koppintása nyitja
 * a sáv-menüt. (Tableten ugyanezek külön ikongombok a fejlécben.)
 */
export function openTrackMenu(t: TFunction, type: TrackType, state: TrackMenuState) {
  const {
    mutedTracks,
    soloTracks,
    lockedTracks,
    collapsedTracks,
    hiddenTracks,
    autoTrackHeight,
    toggleTrackFlag,
    cycleTrackHeight,
    toggleAutoTrackHeight,
  } = state;
  const muted = mutedTracks.includes(type);
  const solo = soloTracks.includes(type);
  const locked = lockedTracks.includes(type);
  const collapsed = collapsedTracks.includes(type);
  const hidden = hiddenTracks.includes(type);
  const buttons: MenuButton[] = [];
  if (AUDIBLE_TRACKS.includes(type)) {
    buttons.push(
      {
        text: muted ? t('editor.timeline.unmute') : t('editor.timeline.mute'),
        onPress: () => toggleTrackFlag(type, 'mute'),
      },
      {
        text: solo ? t('editor.timeline.soloOff') : t('editor.timeline.soloOn'),
        onPress: () => toggleTrackFlag(type, 'solo'),
      }
    );
  }
  if (VISUAL_TRACKS.includes(type)) {
    buttons.push({
      text: hidden ? t('editor.timeline.show') : t('editor.timeline.hide'),
      onPress: () => toggleTrackFlag(type, 'hidden'),
    });
  }
  buttons.push(
    {
      text: locked ? t('editor.timeline.unlock') : t('editor.timeline.lock'),
      onPress: () => toggleTrackFlag(type, 'lock'),
    },
    {
      text: collapsed ? t('editor.timeline.expand') : t('editor.timeline.collapse'),
      onPress: () => toggleTrackFlag(type, 'collapse'),
    },
    {
      text: t('editor.timeline.height'),
      onPress: () => cycleTrackHeight(type),
    },
    {
      text: autoTrackHeight ? t('editor.timeline.autoHeightOff') : t('editor.timeline.autoHeightOn'),
      onPress: () => toggleAutoTrackHeight(),
    },
    { text: t('common.cancel'), style: 'cancel' }
  );
  Alert.alert(t(trackLabels[type]), t('editor.timeline.trackMenuMessage'), buttons);
}

/** 🧲 illesztési célpont-fajták kapcsolója (a magnet hosszú nyomására) */
export function openSnapMenu(
  t: TFunction,
  snapTargets: SnapTargets,
  toggleSnapTarget: EditorState['toggleSnapTarget']
) {
  const row = (key: keyof typeof snapTargets, labelKey: string) => ({
    text: `${snapTargets[key] ? '✓ ' : '  '}${t(labelKey)}`,
    onPress: () => toggleSnapTarget(key),
  });
  Alert.alert(t('editor.snap.targetsTitle'), t('editor.snap.targetsMessage'), [
    row('playhead', 'editor.snap.targetPlayhead'),
    row('clips', 'editor.snap.targetClips'),
    row('markers', 'editor.snap.targetMarkers'),
    row('beats', 'editor.snap.targetBeats'),
    row('regions', 'editor.snap.targetRegions'),
    { text: t('common.done'), style: 'cancel' },
  ]);
}

/** 🅸🅾 tartomány-műveletek (a range-sávra koppintva) */
export function openRangeMenu(
  t: TFunction,
  actions: { regionFromRange: () => void; deleteRange: () => void; clearRange: () => void }
) {
  const { regionFromRange, deleteRange, clearRange } = actions;
  Alert.alert(t('editor.range.title'), t('editor.range.message'), [
    { text: t('editor.range.region'), onPress: () => regionFromRange() },
    { text: t('editor.range.delete'), style: 'destructive', onPress: () => deleteRange() },
    { text: t('editor.range.clear'), onPress: () => clearRange() },
    { text: t('common.cancel'), style: 'cancel' },
  ]);
}

/** 🔖 jelölő-menü (átnevezés / jegyzet / átszínezés / törlés) — a zászló hosszú nyomására */
export function openMarkerMenu(t: TFunction, markerId: string) {
  const state = useEditorStore.getState();
  const markers = state.project?.markers ?? [];
  const m = markers.find((x) => x.id === markerId);
  if (!m) {
    return;
  }
  const save = (patch: Partial<typeof m>) =>
    state.dispatch({
      type: 'SET_MARKERS',
      markers: markers.map((x) => (x.id === markerId ? { ...x, ...patch } : x)),
    });
  const promptNote = () => {
    if (typeof Alert.prompt === 'function') {
      Alert.prompt(
        t('editor.marker.noteTitle'),
        undefined,
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.save'), onPress: (v?: string) => save({ note: (v ?? '').trim() || undefined }) },
        ],
        'plain-text',
        m.note ?? ''
      );
    }
  };
  const buttons: MenuButton[] = [];
  if (typeof Alert.prompt === 'function') {
    buttons.push({
      text: t('editor.marker.rename'),
      onPress: () =>
        Alert.prompt(
          t('editor.marker.renameTitle'),
          undefined,
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.save'), onPress: (v?: string) => save({ label: (v ?? '').trim() || m.label }) },
          ],
          'plain-text',
          m.label
        ),
    });
    buttons.push({ text: m.note ? t('editor.marker.editNote') : t('editor.marker.addNote'), onPress: promptNote });
  }
  buttons.push(
    {
      text: t('editor.transportBar.recolorMarker'),
      onPress: () => save({ color: nextMarkerColor(m.color) }),
    },
    {
      text: t('common.delete'),
      style: 'destructive',
      onPress: () =>
        state.dispatch({ type: 'SET_MARKERS', markers: markers.filter((x) => x.id !== markerId) }),
    },
    { text: t('common.cancel'), style: 'cancel' }
  );
  Alert.alert(m.label, m.note ?? t('editor.marker.menuMessage'), buttons);
}
