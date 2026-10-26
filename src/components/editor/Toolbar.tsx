import { haptics, motion } from '@/design';
import type { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { SourceSheet } from '@/components/SourceSheet';
import { CameraRecorder } from '@/components/editor/CameraRecorder';
import { HelpOverlay } from '@/components/editor/HelpOverlay';
import { SelectionInfo } from '@/components/editor/SelectionInfo';
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ToolButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { captureFrame } from '@/lib/captureFrame';
import { getLesson, type TutorialTargetId } from '@/lib/tutorial';
import { makeId } from '@/lib/id';
import { pickImage, pickVideo } from '@/lib/media';
import { ensureProxy } from '@/lib/proxy';
import { describeStyle, duplicateOffset } from '@/lib/batchEdit';
import { toolbarFor, type ToolId } from '@/lib/toolbarSpec';
import { clipEnd, compatibleTracksFor, findClip, trackEnd, trackOf } from '@/lib/projectUtils';
import { selectSelectedClip, useEditorStore, type PanelId } from '@/store/editorStore';
import { useToast } from '@/store/toastStore';
import { useTutorial } from '@/store/tutorialStore';
import type { Asset, Clip, TrackType } from '@/types/project';

/**
 * Kontextusfüggő eszköztár: kijelölés nélkül a hozzáadás-műveletek, kijelölt
 * klipnél a klip-műveletek. Kontextusonként max 4 elsődleges eszköz + „Több"
 * (MOBILE-UI §6.4) — a „Kész" és a „Törlés" króm, nem számít bele a 4-be.
 */
export function Toolbar({ variant = 'bar' }: { variant?: 'bar' | 'rail' } = {}) {
  const { t } = useTranslation();
  const selected = useEditorStore(selectSelectedClip);
  const [showCamera, setShowCamera] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setPanel = useEditorStore((s) => s.setPanel);
  const addClip = useEditorStore((s) => s.addClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const splitClipAt = useEditorStore((s) => s.splitClipAt);
  const selectClip = useEditorStore((s) => s.selectClip);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  const multiSelectMode = useEditorStore((s) => s.multiSelectMode);
  const setMultiSelectMode = useEditorStore((s) => s.setMultiSelectMode);
  const batchCount = multiSelectIds.length + 1;
  const styleClipboard = useEditorStore((s) => s.styleClipboard);
  // beilleszteni csak azonos fajtájú klipre lehet (a stílus-mezők kind-függők)
  const rippleMode = useEditorStore((s) => s.rippleMode);
  const setRippleMode = useEditorStore((s) => s.setRippleMode);
  // 🔗 link-csoportok: linkelt klipek együtt mozognak
  const projectLinks = useEditorStore((s) => s.project?.links);
  const linkSelected = useEditorStore((s) => s.linkSelected);
  const preCompose = useEditorStore((s) => s.preCompose);
  const unlinkClip = useEditorStore((s) => s.unlinkClip);
  const isLinked = !!selected && !!projectLinks?.some((g) => g.includes(selected.id));
  const canPasteStyle = Boolean(
    styleClipboard && selected && styleClipboard.kind === selected.kind
  );
  // 📋 klip-vágólap (egész klip) — a Beilleszt a vágólap tartalmára jelenik meg
  const clipClipboard = useEditorStore((s) => s.clipClipboard);
  const canPasteClips = Boolean(clipClipboard);
  // ↕️ sávváltás: csak ha a klip fajtájához több kompatibilis sáv van (pl. video↔pip)
  const canMoveTrack = Boolean(selected && compatibleTracksFor(selected.kind).length >= 2);
  // 🎬 a kijelölt klip a pip-sávon van-e? (a „Keret" gomb csak ott jelenik meg)
  const onPipTrack = useEditorStore(
    (s) =>
      !!selected &&
      (s.project?.tracks.find((t) => t.type === 'pip')?.clips.some((c) => c.id === selected.id) ??
        false)
  );

  const addVideo = async () => {
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    const { project } = useEditorStore.getState();
    if (!project) {
      return;
    }
    const duration = picked.duration > 0 ? picked.duration : 5;
    addClip(
      'video',
      {
        kind: 'video',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration,
        uri: picked.uri,
        trimIn: 0,
        sourceDuration: duration,
        speed: 1,
        volume: 1,
        filterId: 'none',
      },
      {
        id: makeId('ast'),
        kind: 'video',
        uri: picked.uri,
        provider: 'local',
        duration,
        width: picked.width,
        height: picked.height,
      }
    );
    // a 720p vágási proxy már készülhet, mire lejátszásra kerül
    ensureProxy(picked.uri).catch(() => {});
  };

  // 🎬 PiP: a videó a PIP-sávra kerül a lejátszófejnél, alap kis mérettel (jobb-fent)
  // — a fő videó FÖLÉ overlay-eződik; húzással/csippentéssel áthelyezhető/méretezhető.
  const addPip = async () => {
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    const { project, playhead } = useEditorStore.getState();
    if (!project) {
      return;
    }
    const source = picked.duration > 0 ? picked.duration : 5;
    const duration = Math.min(source, 10);
    // több PiP esetén a következő másik sarokba kerül (ne fedjék pontosan egymást)
    const pipCount = project.tracks.find((t) => t.type === 'pip')?.clips.length ?? 0;
    const CORNERS = [
      { x: 0.3, y: -0.32 },
      { x: -0.3, y: -0.32 },
      { x: 0.3, y: 0.32 },
      { x: -0.3, y: 0.32 },
    ];
    const corner = CORNERS[pipCount % CORNERS.length];
    addClip(
      'pip',
      {
        kind: 'video',
        id: makeId('clip'),
        start: playhead,
        duration,
        uri: picked.uri,
        trimIn: 0,
        sourceDuration: source,
        speed: 1,
        volume: 1,
        filterId: 'none',
        transform: { scale: 0.32, x: corner.x, y: corner.y },
      },
      {
        id: makeId('ast'),
        kind: 'video',
        uri: picked.uri,
        provider: 'local',
        duration: source,
        width: picked.width,
        height: picked.height,
      }
    );
    ensureProxy(picked.uri).catch(() => {});
  };

  const addImage = async () => {
    const picked = await pickImage();
    if (!picked) {
      return;
    }
    const { project } = useEditorStore.getState();
    if (!project) {
      return;
    }
    addClip(
      'video',
      {
        kind: 'image',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration: 4,
        uri: picked.uri,
        filterId: 'none',
      },
      { id: makeId('ast'), kind: 'image', uri: picked.uri, provider: 'local' }
    );
  };

  // 🗂️ forrás-mappából az idővonalra: a fajtának megfelelő klip (videó/kép a videó-
  // sáv végére, hang a 'music' sávra a playheadnél). A meglévő asset nem duplikálódik.
  const insertSource = (asset: Asset) => {
    // a forrás→timeline beszúrás közös magja (Toolbar + dokkolt forrás-panel + §2.2 drag)
    useEditorStore.getState().insertSourceAsset(asset);
    setShowSource(false);
  };

  const addText = () => {
    const { playhead } = useEditorStore.getState();
    addClip('text', {
      kind: 'text',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      text: t('editor.toolbar.newTextDefault'),
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 7,
      fontWeight: 'bold',
      position: { x: 0.5, y: 0.5 },
      animation: 'fade',
    });
    setPanel('text');
  };

  const addHotspot = () => {
    const { playhead } = useEditorStore.getState();
    addClip('interactive', {
      kind: 'interactive',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      label: 'Hotspot',
      rect: { x: 0.35, y: 0.4, w: 0.3, h: 0.2 },
      // üres URL: a panel placeholderje (https://…) vezeti a felhasználót, és a
      // validáció addig üres/érvénytelen linknek jelzi, míg valódi címet nem ad meg
      action: { type: 'url', url: '' },
    });
    setPanel('hotspot');
  };

  // 🎨 Grade-réteg: az adjust-sávra kerül a lejátszófejnél; a saját szakaszában
  // az ALATTA lévő teljes kompozitra ad nem-destruktív színkorrekciót (CapCut-minta).
  const addAdjust = () => {
    const { project, playhead } = useEditorStore.getState();
    if (!project) {
      return;
    }
    // védett: régi projektben hiányozhat az adjust-sáv (a migráció pótolja, de
    // ne dobjunk, ha valamiért mégsem — a lejátszófejnél kezdünk)
    const track = project.tracks.find((t) => t.type === 'adjust');
    if (!track) {
      return;
    }
    // enyhe alap-grade, hogy rögtön látszódjon a réteg hatása (finomítható)
    const start = Math.max(playhead, trackEnd(track) > playhead ? trackEnd(track) : playhead);
    const id = makeId('clip');
    addClip('adjust', {
      kind: 'adjust',
      id,
      start,
      duration: 4,
      adjust: { contrast: 0.08, saturation: 0.1 },
    });
    selectClip(id);
    setPanel('adjust');
  };

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
    const picked = ids
      .map((id) => findClip(project, id))
      .filter((f): f is NonNullable<typeof f> => f != null);
    const offset = duplicateOffset(picked.map((f) => f.clip));
    const byTrack = new Map<TrackType, Clip[]>();
    for (const { track, clip } of picked) {
      const list = byTrack.get(track.type) ?? [...track.clips];
      list.push({ ...clip, id: makeId('clip'), start: clip.start + offset });
      byTrack.set(track.type, list);
    }
    state.dispatch(
      {
        type: 'REPLACE_TRACKS',
        tracks: [...byTrack.entries()].map(([trackType, clips]) => ({
          trackType,
          clips: clips.sort((a, b) => a.start - b.start),
        })),
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
    const fallback: Record<Clip['kind'], TrackType> = {
      video: 'video', image: 'video', audio: 'music', text: 'text',
      shape: 'overlay', adjust: 'adjust', interactive: 'interactive',
    };
    const trackType = selectedTrack ?? fallback[cb.kind];
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
    const tracks = project.tracks
      .filter((t) => t.clips.some((c) => ids.has(c.id)))
      .map((t) => ({
        trackType: t.type,
        clips: t.clips.filter((c) => !ids.has(c.id)),
      }));
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

  const togglePanel = (panel: NonNullable<typeof activePanel>) => {
    setPanel(activePanel === panel ? null : panel);
  };

  const [moreOpen, setMoreOpen] = useState(false);
  // a „Több"-ből indított, ÚJ modált/natív képernyőt nyitó akció (képválasztó, kamera,
  // forrás, súgó) csak a lap TELJES lezárulása után fut — iOS-en a záródó Modal alatt
  // indított prezentáció csendben elveszne. (A panel-váltás azonnali: az nem modál.)
  const pendingMoreAction = useRef<(() => void) | null>(null);
  const runPendingMoreAction = () => {
    const fn = pendingMoreAction.current;
    pendingMoreAction.current = null;
    fn?.();
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
      .catch(() => Alert.alert(t('editor.toolbar.frameCaptureTitle'), t('editor.toolbar.frameCaptureFailed')));
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

  /**
   * 🧰 Az eszközök regisztere (MOBILE-UI §6.4) — MIT csinál egy eszköz. Hogy
   * MIKOR és HOL (elöl vagy a „Több" alatt) jelenik meg, azt a pure
   * `toolbarFor()` dönti el a kontextusból (`@/lib/toolbarSpec`, tesztelve).
   */
  const multi = multiSelectIds.length > 0;
  const TOOLS: Record<ToolId, ToolDef> = {
    // — kijelölés nélkül —
    addVideo: { icon: 'videocam-outline', label: t('editor.toolbar.video'), onPress: addVideo, tutorialId: 'toolbar.addVideo' },
    addText: { icon: 'text-outline', label: t('editor.toolbar.text'), onPress: addText, tutorialId: 'toolbar.text' },
    music: { icon: 'musical-notes-outline', label: t('editor.toolbar.music'), panel: 'audio', tutorialId: 'toolbar.music' },
    captions: { icon: 'chatbox-ellipses-outline', label: t('editor.toolbar.captions'), panel: 'captions', tutorialId: 'toolbar.captions' },
    addImage: { icon: 'image-outline', label: t('editor.toolbar.image'), onPress: addImage },
    addPip: { icon: 'albums-outline', label: 'PiP', onPress: addPip },
    record: { icon: 'radio-button-on-outline', label: t('editor.toolbar.record'), onPress: () => setShowCamera(true) },
    source: { icon: 'folder-open-outline', label: t('source.title'), onPress: () => setShowSource(true) },
    sticker: { icon: 'happy-outline', label: t('editor.toolbar.sticker'), panel: 'sticker' },
    transcript: { icon: 'reader-outline', label: t('editor.toolbar.transcript'), panel: 'transcript' },
    addGrade: { icon: 'color-filter-outline', label: t('editor.toolbar.grade'), onPress: addAdjust, tutorialId: 'toolbar.grade' },
    imagedoc: { icon: 'layers-outline', label: t('editor.toolbar.layers'), panel: 'imagedoc' },
    library: { icon: 'server-outline', label: t('editor.toolbar.library'), panel: 'library' },
    multicam: { icon: 'videocam-outline', label: t('editor.toolbar.multicam'), panel: 'multicam', tutorialId: 'toolbar.multicam' },
    addHotspot: { icon: 'scan-outline', label: 'Hotspot', onPress: addHotspot },
    assistant: { icon: 'sparkles-outline', label: 'AI', panel: 'assistant', tutorialId: 'toolbar.ai' },
    creatorPreset: { icon: 'bookmarks-outline', label: t('editor.toolbar.creatorPreset'), panel: 'creatorPreset' },
    workflow: { icon: 'git-branch-outline', label: t('editor.toolbar.workflow'), panel: 'workflow' },
    help: { icon: 'help-circle-outline', label: t('editor.toolbar.help'), onPress: () => setShowHelp(true) },
    // — kijelölt klip —
    split: { icon: 'cut-outline', label: t('editor.toolbar.split'), onPress: split },
    speed: { icon: 'speedometer-outline', label: t('editor.toolbar.speed'), panel: 'speed' },
    filter: { icon: 'color-filter-outline', label: t('editor.toolbar.filter'), panel: 'filter' },
    transition: { icon: 'contrast-outline', label: t('editor.toolbar.transition'), panel: 'transition' },
    pip: { icon: 'ellipse-outline', label: t('editor.toolbar.frame'), panel: 'pip' },
    frameCapture: { icon: 'camera-outline', label: t('editor.toolbar.frameCapture'), onPress: frameCaptureAction },
    text: { icon: 'text-outline', label: t('editor.toolbar.text'), panel: 'text' },
    shape: { icon: 'shapes-outline', label: t('editor.toolbar.shape'), panel: 'shape' },
    grade: { icon: 'color-filter-outline', label: t('editor.toolbar.grade'), panel: 'adjust' },
    mix: { icon: 'options-outline', label: t('editor.toolbar.mix'), panel: 'audio' },
    action: { icon: 'link-outline', label: t('editor.toolbar.action'), panel: 'hotspot' },
    precision: { icon: 'timer-outline', label: t('editor.toolbar.precision'), panel: 'precision' },
    duplicate: {
      icon: 'copy-outline',
      label: multi ? t('editor.toolbar.duplicateCount', { count: batchCount }) : t('common.duplicate'),
      onPress: duplicate,
    },
    copyClip: { icon: 'albums-outline', label: t('editor.toolbar.copyClip'), onPress: copyClipsAction },
    cutClip: { icon: 'cut-outline', label: t('editor.toolbar.cutClip'), onPress: cutClipsAction },
    pasteClip: { icon: 'clipboard-outline', label: t('editor.toolbar.pasteClip'), onPress: pasteClipsAction },
    copyStyle: { icon: 'clipboard-outline', label: t('editor.toolbar.copyStyle'), onPress: copyStyleAction },
    pasteStyle: {
      icon: 'color-wand-outline',
      label: multi ? t('editor.toolbar.pasteStyleCount', { count: batchCount }) : t('editor.toolbar.pasteStyle'),
      onPress: pasteStyleAction,
    },
    moveTrack: { icon: 'swap-vertical-outline', label: t('editor.toolbar.moveTrack'), onPress: moveToNextTrack },
    multiSelect: {
      icon: multiSelectMode ? 'checkmark-done' : 'checkmark-done-outline',
      label: multiSelectMode
        ? t('editor.toolbar.multiSelectActive', { count: batchCount })
        : t('editor.toolbar.multiSelect'),
      onPress: toggleMultiSelect,
      active: multiSelectMode,
    },
    ripple: {
      icon: rippleMode ? 'git-commit' : 'git-commit-outline',
      label: t('editor.toolbar.ripple'),
      onPress: toggleRipple,
      active: rippleMode,
    },
    link: { icon: 'link', label: t('editor.toolbar.link'), onPress: linkSelected },
    precompose: { icon: 'cube-outline', label: t('editor.toolbar.precompose'), onPress: preCompose },
    unlink: { icon: 'unlink', label: t('editor.toolbar.unlink'), onPress: () => selected && unlinkClip(selected.id) },
  };

  const layout = toolbarFor({
    selectionKind: selected?.kind ?? null,
    multi: multiSelectMode && multiSelectIds.length >= 1,
    onPipTrack,
    linked: isLinked,
    hasClipClipboard: canPasteClips,
    canPasteStyle,
    canMoveTrack,
  });

  // kontextuális toolbar cross-fade REMOUNT NÉLKÜL: a tool-készlet váltásakor
  // (idle↔kijelölés / más klip-fajta) csak az OPACITY pulzál.
  const toolFade = useSharedValue(1);
  const toolSig = selected ? `${selected.kind}${multiSelectMode ? '-m' : ''}` : 'idle';
  useEffect(() => {
    toolFade.value = 0;
    toolFade.value = withTiming(1, { duration: motion.duration.fast });
  }, [toolSig, toolFade]);
  const toolRowStyle = useAnimatedStyle(() => ({ opacity: toolFade.value }));

  // 🎓 tutorial: ha az aktív lecke-lépés egy „Több" alá került eszközre mutat, az
  // eszköz IDEIGLENESEN előrekerül a sorba — így a spotlight mindig ráül.
  const activeTutorialTarget = useTutorial((s) =>
    s.activeLessonId ? (getLesson(s.activeLessonId)?.steps[s.stepIndex]?.target ?? null) : null
  );
  const promoted = activeTutorialTarget
    ? layout.overflow.find((id) => TOOLS[id].tutorialId === activeTutorialTarget)
    : undefined;
  const rowTools = promoted ? [...layout.primary, promoted] : layout.primary;
  const moreTools = promoted ? layout.overflow.filter((id) => id !== promoted) : layout.overflow;

  const rail = variant === 'rail';
  const renderTool = (id: ToolId, onAfter?: () => void) => {
    const def = TOOLS[id];
    // a vízszintes sávban (nem a railen / nem a „Több" rácsban) egyenlő cellák
    const fillCell = !rail && !onAfter;
    const button = (
      <ToolButton
        fill={fillCell}
        icon={def.icon}
        label={def.label}
        active={def.panel ? activePanel === def.panel : def.active}
        onPress={() => {
          onAfter?.();
          if (def.panel) {
            togglePanel(def.panel);
          } else if (onAfter) {
            pendingMoreAction.current = def.onPress ?? null;
          } else {
            def.onPress?.();
          }
        }}
      />
    );
    return def.tutorialId && !onAfter ? (
      <TutorialTarget key={id} id={def.tutorialId} style={fillCell ? styles.cell : undefined}>
        {button}
      </TutorialTarget>
    ) : (
      <View key={id} style={fillCell ? styles.cell : undefined}>
        {button}
      </View>
    );
  };

  const toolRow = (
    <Animated.View style={[rail ? styles.toolColumn : styles.toolRow, toolRowStyle]}>
      {selected ? (
        <View style={rail ? undefined : styles.cell}>
          <ToolButton
            fill={!rail}
            icon="checkmark-circle-outline"
            label={t('common.done')}
            onPress={() => selectClip(null)}
          />
        </View>
      ) : null}
      {rowTools.map((id) => renderTool(id))}
      {moreTools.length > 0 ? (
        <View style={rail ? undefined : styles.cell}>
          <ToolButton
            fill={!rail}
            icon="ellipsis-horizontal-circle-outline"
            label={t('editor.toolbar.more')}
            onPress={() => setMoreOpen(true)}
          />
        </View>
      ) : null}
      {selected ? (
        <>
          {/* elválasztó: a destruktív Törlés elkülönül a többi eszköztől */}
          <View style={rail ? styles.toolSepH : styles.toolSep} />
          <View style={rail ? undefined : styles.cell}>
            <ToolButton
              fill={!rail}
              icon="trash-outline"
              label={multi ? t('editor.toolbar.deleteCount', { count: batchCount }) : t('common.delete')}
              danger
              onPress={remove}
            />
          </View>
        </>
      ) : null}
      {/* Export SZÁNDÉKOSAN nincs itt: a fejléc jobb felső Export gombja az
          egyetlen belépő (a duplikáció megszüntetve — lásd editor/[id].tsx). */}
    </Animated.View>
  );

  return (
    <View style={rail ? styles.railContainer : styles.container}>
      {/* 🧭 „What am I editing?" — a kijelölt elem fajtája · neve · idő-tartománya
          (railnél a képernyő az idővonal fölé teszi — a keskeny oszlopba nem fér) */}
      {rail ? null : <SelectionInfo />}
      {/* a vízszintes sáv max ~7 gombja EGYENLŐ cellákban, görgetés nélkül fér ki (fekvőben
          is — élő teszt L1: a Törlés kilógott); a rail függőlegesen görgethető. A sor NEM
          remountol a készlet-váltáskor, csak átúszik (MOBILE-UI §6.4). */}
      {rail ? <ScrollView showsVerticalScrollIndicator={false}>{toolRow}</ScrollView> : toolRow}
      {/* ⋯ „Több" — ikonrács modális lapon (menü, nem élő szerkesztés → a scrim rendben) */}
      <BottomSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onDismissed={runPendingMoreAction}
        maxHeightFraction={0.6}
        accessibilityLabel={t('editor.toolbar.more')}
      >
        <Text style={styles.moreTitle}>{t('editor.toolbar.moreTitle')}</Text>
        <ScrollView contentContainerStyle={styles.moreGrid}>
          {moreTools.map((id) => (
            <View key={id} style={styles.moreCell}>
              {renderTool(id, () => setMoreOpen(false))}
            </View>
          ))}
        </ScrollView>
      </BottomSheet>
      <CameraRecorder visible={showCamera} onClose={() => setShowCamera(false)} />
      {showSource ? (
        <SourceSheet onInsert={insertSource} onClose={() => setShowSource(false)} />
      ) : null}
      {showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} /> : null}
    </View>
  );
}

/** egy eszköz definíciója: vagy panelt vált (`panel`), vagy akciót futtat (`onPress`) */
interface ToolDef {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  panel?: NonNullable<PanelId>;
  onPress?: () => void;
  active?: boolean;
  tutorialId?: TutorialTargetId;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingVertical: 4,
  },
  moreTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // ⋯ „Több" ikonrács: 4 oszlop
  moreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  moreCell: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 6,
  },
  // 🖥️ bal oldali rail (iPad fekvő / expanded, MOBILE-UI §7): keskeny, ikonközpontú oszlop
  railContainer: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingVertical: 6,
  },
  toolColumn: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  toolSepH: {
    height: 1,
    width: 28,
    alignSelf: 'center',
    marginVertical: 8,
    backgroundColor: palette.border,
  },
  // a vízszintes sáv: egyenlő cellák a teljes szélességen
  toolRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  cell: { flex: 1, minWidth: 0 },
  // függőleges elválasztó a destruktív művelet (Törlés) elkülönítéséhez
  toolSep: {
    width: 1,
    height: 28,
    alignSelf: 'center',
    marginHorizontal: 8,
    backgroundColor: palette.border,
  },
});
