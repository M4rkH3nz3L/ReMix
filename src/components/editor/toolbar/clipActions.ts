import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { haptics } from '@/design';
import { describeStyle } from '@/lib/batchEdit';
import { captureFrame } from '@/lib/captureFrame';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { clipEnd, findClip } from '@/lib/projectUtils';
import { duplicatedTracks, PASTE_FALLBACK_TRACK, tracksWithoutClips } from '@/lib/toolbarOps';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import { useToast } from '@/store/toastStore';
import type { Clip } from '@/types/project';

/** a klip-műveletek a gyökér store-szelektoraiból és a kijelölt klipből élnek */
export interface ClipActionDeps {
  t: TFunction;
  selected: Clip | null;
  addClip: EditorState['addClip'];
  removeClip: EditorState['removeClip'];
  splitClipAt: EditorState['splitClipAt'];
  multiSelectMode: boolean;
  setMultiSelectMode: EditorState['setMultiSelectMode'];
  rippleMode: boolean;
  setRippleMode: EditorState['setRippleMode'];
}

/**
 * ✂️ Kijelölt klip(ek) műveletei: vágás, duplikálás, klip- és stílus-vágólap,
 * sávváltás, törlés (ripple / köteg), képkocka-mentés, multi-/ripple-kapcsoló.
 * A kötegelt műveletek egy undo-lépésben (`REPLACE_TRACKS`, actor: 'user').
 */
export function createClipActions({
  t,
  selected,
  addClip,
  removeClip,
  splitClipAt,
  multiSelectMode,
  setMultiSelectMode,
  rippleMode,
  setRippleMode,
}: ClipActionDeps) {
  const split = () => {
    if (!selected) {
      return;
    }
    const { playhead } = useEditorStore.getState();
    const ok = splitClipAt(selected.id, playhead);
    if (ok) {
      haptics.impact();
    } else {
      Alert.alert(t('editor.toolbar.cannotSplitTitle'), t('editor.toolbar.cannotSplitMessage'));
    }
  };

  const duplicate = () => {
    const state = useEditorStore.getState();
    const { project } = state;
    if (!selected || !project) {
      return;
    }
    const ids = state.allSelectedIds();
    if (ids.length === 1) {
      // a klip a saját sávjára duplikálódik (a kind többsávos is lehet)
      const found = findClip(project, selected.id);
      if (!found) {
        return;
      }
      addClip(found.track.type, {
        ...selected,
        id: makeId('clip'),
        start: clipEnd(selected),
      });
      return;
    }
    // 🧩 kötegelt duplikálás: a másolatok a kijelölés UTÁN, a saját relatív
    // távolságukat megtartva — a ritmus nem borul fel; egy undo-lépés
    state.dispatch(
      {
        type: 'REPLACE_TRACKS',
        tracks: duplicatedTracks(project, ids),
        label: t('editor.toolbar.clipsDuplicatedLabel', { count: ids.length }),
      },
      'user'
    );
  };

  // 📋 klip-vágólap (egész klip cut/copy/paste; §2.4)
  const copyClipsAction = () => {
    if (useEditorStore.getState().copyClips() > 0) {
      haptics.selection();
    }
  };
  // ↶ a destruktív művelet után ott, ahol koppintott, egy koppintással visszavonható
  const undoToast = (message: string) =>
    useToast.getState().show(message, {
      label: t('editor.toast.undo'),
      onPress: () => useEditorStore.getState().undo(),
    });

  const cutClipsAction = () => {
    const n = useEditorStore.getState().cutClips();
    if (n > 0) {
      haptics.impact();
      undoToast(t('editor.toast.clipsCut', { count: n }));
    }
  };
  const pasteClipsAction = () => {
    const state = useEditorStore.getState();
    const { project, playhead, clipClipboard: cb } = state;
    if (!project || !cb) {
      return;
    }
    // cél-sáv: a kijelölt klip sávja; ha nincs kijelölés, a vágólap fajtájához illő alap
    const selectedTrack = selected ? findClip(project, selected.id)?.track.type : undefined;
    const trackType = selectedTrack ?? PASTE_FALLBACK_TRACK[cb.kind];
    const n = state.pasteClipsAt(trackType, playhead);
    if (n > 0) {
      haptics.snap();
    } else {
      Alert.alert(t('editor.toolbar.styleAlertTitle'), t('editor.toolbar.nothingToPaste'));
    }
  };

  // ↕️ a kijelölt klip a következő kompatibilis sávra (video↔pip, music→voiceover→sfx…)
  const moveToNextTrack = () => {
    if (useEditorStore.getState().moveSelectedClipToNextTrack()) {
      haptics.snap();
    }
  };

  const remove = () => {
    const state = useEditorStore.getState();
    const { project } = state;
    if (!selected || !project) {
      return;
    }
    const ids = new Set(state.allSelectedIds());
    // ⏭️ ripple módban a lyuk bezárul — minden sáv csúszik, a szinkron marad
    if (state.rippleMode) {
      const list = [...ids];
      Alert.alert(
        t('editor.toolbar.rippleDeleteTitle'),
        t('editor.toolbar.rippleDeleteMessage', { count: list.length }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => {
              if (!useEditorStore.getState().rippleDelete(list)) {
                Alert.alert(t('editor.toolbar.rippleDeleteTitle'), t('editor.toolbar.rippleDeleteFailed'));
              } else {
                undoToast(t('editor.toast.clipsDeleted', { count: list.length }));
              }
            },
          },
        ]
      );
      return;
    }
    if (ids.size === 1) {
      removeClip(selected.id);
      undoToast(t('editor.toast.clipsDeleted', { count: 1 }));
      return;
    }
    // 🧩 kötegelt törlés — egy undo-lépésben, minden érintett sávról
    const tracks = tracksWithoutClips(project, ids);
    Alert.alert(
      t('editor.toolbar.deleteSelectedTitle'),
      t('editor.toolbar.deleteSelectedMessage', { count: ids.size }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            const s2 = useEditorStore.getState();
            s2.dispatch({ type: 'REPLACE_TRACKS', tracks, label: t('editor.toolbar.clipsDeletedLabel', { count: ids.size }) }, 'user');
            s2.selectClip(null);
            undoToast(t('editor.toast.clipsDeleted', { count: ids.size }));
          },
        },
      ]
    );
  };

  const copyStyleAction = () => {
    if (!useEditorStore.getState().copyStyle()) {
      return;
    }
    // FONTOS: a vágólapot a copyStyle UTÁN kell kiolvasni. A zustand
    // minden `set`-nél ÚJ state-objektumot ad, így a hívás ELŐTT
    // vett pillanatképen a styleClipboard még a régi (első
    // használatkor `null`) — abból lett a „Cannot read property
    // 'style' of null" összeomlás.
    const clipboard = useEditorStore.getState().styleClipboard;
    if (!clipboard) {
      return;
    }
    haptics.selection();
    Alert.alert(
      t('editor.toolbar.styleCopiedTitle'),
      t('editor.toolbar.styleCopiedMessage', { style: describeStyle(clipboard.style) })
    );
  };

  const pasteStyleAction = () => {
    const n = useEditorStore.getState().pasteStyle();
    if (n > 0) {
      haptics.snap();
    } else {
      Alert.alert(t('editor.toolbar.styleAlertTitle'), t('editor.toolbar.nothingToPaste'));
    }
  };

  const frameCaptureAction = () => {
    const state = useEditorStore.getState();
    if (selected?.kind !== 'video') {
      return;
    }
    captureFrame(selected, state.playhead)
      .then((result) => {
        if (!result) {
          Alert.alert(t('editor.toolbar.frameCaptureTitle'), t('editor.toolbar.frameCaptureNativeOnly'));
          return;
        }
        const s = useEditorStore.getState();
        s.addClip('video', result.clip, result.asset);
        s.selectClip(result.clip.id);
        // frissen elkapott kockát rögtön a Kép Stúdióban nyitjuk
        s.openImageStudio(result.clip.id);
      })
      .catch((caught) => { logCaught('components/editor/Toolbar.tsx:frameCaptureAction', caught); return Alert.alert(t('editor.toolbar.frameCaptureTitle'), t('editor.toolbar.frameCaptureFailed')); });
  };

  const toggleMultiSelect = () => {
    const on = !multiSelectMode;
    setMultiSelectMode(on);
    if (on) {
      Alert.alert(t('editor.toolbar.multiSelectTitle'), t('editor.toolbar.multiSelectMessage'));
    }
  };

  const toggleRipple = () => {
    const on = !rippleMode;
    setRippleMode(on);
    if (on) {
      Alert.alert(t('editor.toolbar.rippleModeOnTitle'), t('editor.toolbar.rippleModeOnMessage'));
    }
  };

  return {
    split,
    duplicate,
    copyClipsAction,
    cutClipsAction,
    pasteClipsAction,
    moveToNextTrack,
    remove,
    copyStyleAction,
    pasteStyleAction,
    frameCaptureAction,
    toggleMultiSelect,
    toggleRipple,
  };
}
