import { useActionMenu } from '@/store/actionMenuStore';
import { haptics } from '@/design';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { SNAP_PX } from '@/constants/editor';
import { makeId } from '@/lib/id';
import {
  clipMenuSplitAt,
  collectClipSnapTargets,
  leftEdgePreview,
  nearestSnapTarget,
  nextEdgePreview,
  pickSnappedMoveStart,
  rightEdgePreview,
  trimLeftUpdate,
  trimRightPatch,
  wantsTrackStep,
  type ClipEdgePreviewState,
} from '@/lib/timelineClipOps';
import { SNAP_FACTOR, useEditorStore, type EditorState, type TrimMode } from '@/store/editorStore';
import type { Clip, TrackType } from '@/types/project';
import type { TFunction } from 'i18next';

/** runOnJS-célpont is (a mozgatás-gesztus indulásakor) — modul-szintű, stabil függvény */
export function selectionHaptic() {
  haptics.selection();
}

interface Params {
  clip: Clip;
  trackType: TrackType;
  pps: number;
  height: number;
  locked: boolean;
  trimMode: TrimMode;
  multiSelectMode: boolean;
  selectClip: EditorState['selectClip'];
  toggleMultiSelect: EditorState['toggleMultiSelect'];
  toggleTrackFlag: EditorState['toggleTrackFlag'];
  updateClip: EditorState['updateClip'];
  t: TFunction;
  setEdge: Dispatch<SetStateAction<ClipEdgePreviewState | null>>;
  moveDX: SharedValue<number>;
  leftDelta: SharedValue<number>;
  rightDelta: SharedValue<number>;
}

/**
 * 🖐️ A klip gesztusainak JS-oldali célpontjai (runOnJS): koppintás, kontextusmenü,
 * mozgatás-, trim-commit és edge preview. Minden rendernél újra épül (mint eddig a
 * komponensben); a gesztusok és a shared value-k a gyökérben élnek, az állapot csak
 * elengedéskor íródik a store-akciókon át. Nem hook: nincs benne React-hook.
 */
export function createTimelineClipHandlers({
  clip,
  trackType,
  pps,
  height,
  locked,
  trimMode,
  multiSelectMode,
  selectClip,
  toggleMultiSelect,
  toggleTrackFlag,
  updateClip,
  t,
  setEdge,
  moveDX,
  leftDelta,
  rightDelta,
}: Params) {
  // 🧲 az illesztési küszöb az erősség-beállítás szerint (0 = kikapcsolt snap)
  const snapPx = () => SNAP_PX * SNAP_FACTOR[useEditorStore.getState().snapStrength];

  /** 🧲 A konfigurált illesztési CÉLPONTOK (lásd collectClipSnapTargets). */
  const collectSnapTargets = (): number[] => collectClipSnapTargets(useEditorStore.getState(), clip.id);

  /** A `value` legközelebbi célponthoz illesztve, ha SNAP_PX-en belül van. */
  const snapEdge = (value: number): number => {
    const px = snapPx();
    if (px <= 0) {
      return value;
    }
    const thresh = px / pps;
    const best = nearestSnapTarget(value, collectSnapTargets(), thresh);
    if (best !== value) {
      selectionHaptic();
    }
    return best;
  };

  const commitMove = (dx: number, dy = 0) => {
    moveDX.value = 0;
    const st = useEditorStore.getState();
    // ↕️ DRAG-TO-TRACK: ha a függőleges szándék dominál és átlép egy küszöböt (fél+
    // sávnyi), a klip a szomszédos KOMPATIBILIS sávra lép (le = +1, fel = −1). Csak
    // egyedi, NEM-linkelt/köteg klipre és nem slip/slide módban — különben az eredeti
    // vízszintes mozgatás/forrás-csúsztatás marad (zéró regresszió a megszokott húzáson).
    const isGroup =
      !!st.linkGroupOf(clip.id) ||
      (st.multiSelectIds.length > 0 &&
        (clip.id === st.selectedClipId || st.multiSelectIds.includes(clip.id)));
    if (wantsTrackStep(dx, dy, height, trimMode, isGroup)) {
      if (st.moveClipByTrackStep(clip.id, dy > 0 ? 1 : -1)) {
        selectionHaptic();
        return;
      }
      // nincs hova lépni (a lánc szélén / nincs másik kompat. sáv) → essünk vissza
      // a vízszintes mozgatásra az alábbi úton
    }
    // ✂️ slip/slide: a test-húzás nem repozícionál, hanem a forrást/szomszédot csúsztatja
    if (trimMode === 'slip') {
      st.slipEdit(clip.id, dx / pps);
      return;
    }
    if (trimMode === 'slide') {
      st.slideEdit(clip.id, dx / pps);
      return;
    }
    const raw = Math.max(0, clip.start + dx / pps);
    // magnetikus él: a START vagy a VÉG illeszkedjen a legközelebbi célponthoz
    const snapStart = snapEdge(raw);
    const snapEndAsStart = snapEdge(raw + clip.duration) - clip.duration;
    const proposed = pickSnappedMoveStart(raw, snapStart, snapEndAsStart);
    // 🔗 linkelt klipek (#59): a link-csoport együtt mozog (kijelölés nélkül is)
    const link = st.linkGroupOf(clip.id);
    if (link) {
      st.nudgeClipsBy(link, proposed - clip.start);
      return;
    }
    // csoport-mozgatás (#58): ha ez a klip a több-kijelölés része, együtt mozog a csoport
    if (
      st.multiSelectIds.length > 0 &&
      (clip.id === st.selectedClipId || st.multiSelectIds.includes(clip.id))
    ) {
      st.nudgeSelectedBy(proposed - clip.start);
      return;
    }
    updateClip(clip.id, { start: proposed });
  };

  const commitTrimLeft = (dx: number) => {
    leftDelta.value = 0;
    setEdge(null);
    // 🌀 roll: a bal él a KORÁBBI szomszéddal közös vágáspontot tolja
    if (trimMode === 'roll') {
      useEditorStore.getState().rollEdit(clip.id, 'left', dx / pps);
      return;
    }
    // magnetikus bal él a célpontokhoz
    const rawStart = clip.start + dx / pps;
    const snappedStart = snapEdge(rawStart);
    updateClip(clip.id, trimLeftUpdate(clip, snappedStart));
  };

  const commitTrimRight = (dx: number) => {
    rightDelta.value = 0;
    setEdge(null);
    const state = useEditorStore.getState();
    // 🌀 roll: a jobb él a KÖVETKEZŐ szomszéddal közös vágáspontot tolja
    if (trimMode === 'roll') {
      state.rollEdit(clip.id, 'right', dx / pps);
      return;
    }
    const desired = snapEdge(clip.start + clip.duration + dx / pps) - clip.start;
    const patch = trimRightPatch(clip, desired);
    // ⏭️ ripple: a hossz-változás tolja a mögötte lévőket (minden sávon). Explicit
    // ripple trim-mód VAGY a globális ripple-kapcsoló bekapcsolja.
    const ripple = trimMode === 'ripple' || (trimMode === 'normal' && state.rippleMode);
    if (ripple && state.rippleResize(clip.id, patch.duration)) {
      return;
    }
    updateClip(
      clip.id,
      patch.trimIn !== undefined ? { duration: patch.duration, trimIn: patch.trimIn } : { duration: patch.duration }
    );
  };

  // 🔍 clip-edge preview frissítése húzás közben (a forrás-időt frame-re kvantálva,
  // változatlan érték esetén nem renderel újra)
  const previewLeft = (dx: number) => {
    const { tlTime, srcTime } = leftEdgePreview(clip, dx, pps);
    // frame-nyi küszöb: húzás közben csak érdemi elmozdulásra renderel újra
    setEdge((prev) => nextEdgePreview(prev, 'left', srcTime, tlTime));
  };
  const previewRight = (dx: number) => {
    const { tlTime, srcTime } = rightEdgePreview(clip, dx, pps);
    setEdge((prev) => nextEdgePreview(prev, 'right', srcTime, tlTime));
  };
  const clearEdge = () => setEdge(null);

  // köteg-módban a koppintás hozzáad/elvesz, egyébként átvált az elsődleges
  // kijelölésre (a köteg ilyenkor elévül — lásd selectClip a store-ban)
  const handleTap = () => {
    if (locked) {
      // néma no-op helyett: elmondjuk, MIÉRT nem történik semmi + feloldás egy koppintással
      Alert.alert(
        t('editor.timelineClip.lockedTitle'),
        t('editor.timelineClip.lockedBody', { track: t('editor.track.' + trackType) }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('editor.timeline.unlock'), onPress: () => toggleTrackFlag(trackType, 'lock') },
        ]
      );
      return;
    }
    if (multiSelectMode) {
      toggleMultiSelect(clip.id);
      selectionHaptic();
      return;
    }
    selectClip(clip.id);
  };

  /**
   * 📋 Klip-kontextusmenü (Touch/02): long-press-HOLD + elengedés MOZGÁS NÉLKÜL →
   * natív gyors-menü (vágás a playheadnél / duplikálás / törlés). A long-press-drag
   * gesztust ÚJRAHASZNÁLJA (nem ad új, ütköző long-presst): a mozgás-küszöb (`slop.pan`)
   * dönt — alatta menü, fölötte klip-mozgatás. Így a tulajdonjog tiszta marad.
   */
  const showClipMenu = () => {
    const st = useEditorStore.getState();
    haptics.impact();
    const splitAt = clipMenuSplitAt(st.playhead, clip);
    useActionMenu.getState().open(t('editor.track.' + trackType), [
      { label: t('editor.toolbar.multiSelectTitle'), icon: 'checkmark-done-outline', onPress: () => st.beginMultiSelect(clip.id) },
      { label: t('editor.toolbar.splitHere'), icon: 'cut-outline', onPress: () => st.splitClipAt(clip.id, splitAt) },
      {
        label: t('common.duplicate', { defaultValue: 'Duplikálás' }),
        icon: 'copy-outline',
        onPress: () => st.addClip(trackType, { ...clip, id: makeId('clip'), start: clip.start + clip.duration }),
      },
      { label: t('common.delete', { defaultValue: 'Törlés' }), icon: 'trash-outline', destructive: true, onPress: () => st.removeClip(clip.id) },
    ]);
  };

  return {
    commitMove,
    commitTrimLeft,
    commitTrimRight,
    previewLeft,
    previewRight,
    clearEdge,
    handleTap,
    showClipMenu,
  };
}
