import { motion } from '@/design';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { SourceSheet } from '@/components/SourceSheet';
import { CameraRecorder } from '@/components/editor/CameraRecorder';
import { HelpOverlay } from '@/components/editor/HelpOverlay';
import { SelectionInfo } from '@/components/editor/SelectionInfo';
import { palette } from '@/constants/editor';
import { getLesson } from '@/lib/tutorial';
import { toolbarFor } from '@/lib/toolbarSpec';
import { promoteTutorialTool } from '@/lib/toolbarOps';
import { compatibleTracksFor } from '@/lib/projectUtils';
import { selectSelectedClip, useEditorStore } from '@/store/editorStore';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { useTutorial } from '@/store/tutorialStore';
import type { Asset } from '@/types/project';

import { createAddClipActions } from './toolbar/addClipActions';
import { createClipActions } from './toolbar/clipActions';
import { MoreToolsSheet } from './toolbar/MoreToolsSheet';
import { buildToolRegistry } from './toolbar/toolRegistry';
import { ToolbarToolRow } from './toolbar/ToolbarToolRow';

/**
 * Kontextusfüggő eszköztár: kijelölés nélkül a hozzáadás-műveletek, kijelölt
 * klipnél a klip-műveletek. Kontextusonként max 4 elsődleges eszköz + „Több"
 * (MOBILE-UI §6.4) — a „Kész" és a „Törlés" króm, nem számít bele a 4-be.
 */
export function Toolbar({ variant = 'bar' }: { variant?: 'bar' | 'rail' } = {}) {
  const { t } = useTranslation();
  const selected = useEditorStore(selectSelectedClip);
  // 🎚️ Gyors / Haladó / AI mód (D5) — az eszköztár készlete ettől függ
  const editMode = useEditorPrefs((st) => st.editMode);
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

  // ➕ hozzáadás-műveletek (videó, PiP, kép, szöveg, hotspot, grade) — toolbar/addClipActions
  const addActions = createAddClipActions({ t, addClip, setPanel, selectClip });

  // 🗂️ forrás-mappából az idővonalra: a fajtának megfelelő klip (videó/kép a videó-
  // sáv végére, hang a 'music' sávra a playheadnél). A meglévő asset nem duplikálódik.
  const insertSource = (asset: Asset) => {
    // a forrás→timeline beszúrás közös magja (Toolbar + dokkolt forrás-panel + §2.2 drag)
    useEditorStore.getState().insertSourceAsset(asset);
    setShowSource(false);
  };

  // ✂️ klip-műveletek (vágás, duplikálás, vágólapok, törlés…) — toolbar/clipActions
  const clipActions = createClipActions({
    t,
    selected,
    addClip,
    removeClip,
    splitClipAt,
    multiSelectMode,
    setMultiSelectMode,
    rippleMode,
    setRippleMode,
  });

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
  // a „Több" rácsból választott akció félretétele (a cella a refet nem kapja meg)
  const setPendingMoreAction = (fn: (() => void) | null) => {
    pendingMoreAction.current = fn;
  };

  // 🧰 az eszközök regisztere (MIT csinál egy eszköz) — toolbar/toolRegistry
  const multi = multiSelectIds.length > 0;
  const TOOLS = buildToolRegistry({
    t,
    selected,
    multi,
    batchCount,
    multiSelectMode,
    rippleMode,
    add: addActions,
    clip: clipActions,
    setShowCamera,
    setShowSource,
    setShowHelp,
    linkSelected,
    preCompose,
    unlinkClip,
  });

  const layout = toolbarFor({
    mode: editMode,
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
  const { rowTools, moreTools } = promoteTutorialTool(
    layout,
    (id) => TOOLS[id].tutorialId,
    activeTutorialTarget
  );

  const rail = variant === 'rail';
  const toolRow = (
    <ToolbarToolRow
      rail={rail}
      toolRowStyle={toolRowStyle}
      hasSelection={!!selected}
      rowTools={rowTools}
      hasMoreTools={moreTools.length > 0}
      tools={TOOLS}
      activePanel={activePanel}
      togglePanel={togglePanel}
      setPendingMoreAction={setPendingMoreAction}
      multi={multi}
      batchCount={batchCount}
      onDone={() => selectClip(null)}
      onMore={() => setMoreOpen(true)}
      onRemove={clipActions.remove}
    />
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
      <MoreToolsSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onDismissed={runPendingMoreAction}
        moreTools={moreTools}
        tools={TOOLS}
        rail={rail}
        activePanel={activePanel}
        togglePanel={togglePanel}
        setPendingMoreAction={setPendingMoreAction}
      />
      <CameraRecorder visible={showCamera} onClose={() => setShowCamera(false)} />
      {showSource ? (
        <SourceSheet onInsert={insertSource} onClose={() => setShowSource(false)} />
      ) : null}
      {showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingVertical: 4,
  },
  // 🖥️ bal oldali rail (iPad fekvő / expanded, MOBILE-UI §7): keskeny, ikonközpontú oszlop
  railContainer: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingVertical: 6,
  },
});
