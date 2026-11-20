import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NewerSchemaBanner } from '@/components/NewerSchemaBanner';
import { LinkedUpdateBanner } from '@/components/editor/LinkedUpdateBanner';
import { RenderStage } from '@/components/studio/image/RenderStage';
import { UndoGestureArea } from '@/components/UndoGestureArea';
import { SourceSheet } from '@/components/SourceSheet';
import { ImageStudioModal } from '@/components/studio/image/ImageStudioModal';
import { AudioStudioModal } from '@/components/studio/audio/AudioStudioModal';
import { RemixGraphModal } from '@/components/editor/RemixGraphModal';
import { MissingMediaSheet } from '@/components/editor/MissingMediaSheet';
import { OverlayRasterHost } from '@/components/editor/OverlayRasterHost';
import { EditorBanners } from '@/components/editor/screen/EditorBanners';
import { EditorHeader } from '@/components/editor/screen/EditorHeader';
import { EditorLayoutBody } from '@/components/editor/screen/EditorLayoutBody';
import { MissingProjectView } from '@/components/editor/screen/MissingProjectView';
import { ProjectMenuSheet } from '@/components/editor/screen/ProjectMenuSheet';
import { createMissingMediaActions } from '@/components/editor/screen/missingMediaActions';
import { useAutosave } from '@/components/editor/screen/useAutosave';
import { useEditorCollab } from '@/components/editor/screen/useEditorCollab';
import { useEditorWarmup } from '@/components/editor/screen/useEditorWarmup';
import { useForeignSourceToast } from '@/components/editor/screen/useForeignSourceToast';
import { usePanelDeepLink } from '@/components/editor/screen/usePanelDeepLink';
import { useProjectLoader } from '@/components/editor/screen/useProjectLoader';
import { useProjectMenu } from '@/components/editor/screen/useProjectMenu';
import { useTransferAvailability } from '@/components/editor/screen/useTransferAvailability';
import { AudioLayer } from '@/components/preview/AudioLayer';
import { VodProcessingOverlay } from '@/components/editor/VodProcessingOverlay';
import { aspectRatios, palette } from '@/constants/editor';
import { useKeyboardVisible } from '@/hooks/useKeyboardVisible';
import { useLayout } from '@/hooks/useLayout';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { collabScreenPath, nextAspectRatio } from '@/lib/editorScreenOps';
import { layoutBudget } from '@/lib/panelLayout';
import type { MissingMedia } from '@/lib/videdFile';
import {
  selectPanelVisible,
  selectSurfaceTier,
  useEditorStore,
} from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';

/**
 * 🎬 A videó-szerkesztő képernyő — kompozíciós gyökér. A felelősségek a
 * src/components/editor/screen/ alatt (betöltés, mentés, collab, menü, fejléc,
 * sávok, elrendezés); a hookok hívási sorrendje = az effektek eredeti sorrendje.
 */
export default function EditorScreen() {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne a React Compilerrel (előtte kimaradt), de a
  // memoizálás bekapcsolása viselkedés-változás → külön döntés (tools/reactCompiler.test.js KNOWN_BAILS).
  'use no memo';
  const { t } = useTranslation();
  const { id, panel } = useLocalSearchParams<{ id: string; panel?: string }>();
  const project = useEditorStore((s) => s.project);
  const dirty = useEditorStore((s) => s.dirty);
  const tier = useEntitlement((s) => s.effectiveTier());
  const panelVisible = useEditorStore(selectPanelVisible);
  // 📐 MOBILE-UI §4: a panel felület-szintje + detentje → layout-költségvetés
  const surfaceTier = useEditorStore(selectSurfaceTier);
  const panelDetent = useEditorStore((s) => s.panelDetent);
  const [bodyH, setBodyH] = useState(0);
  const [timelineH, setTimelineH] = useState<number | undefined>(undefined);
  const [transportH, setTransportH] = useState<number | undefined>(undefined);
  const { projectMenuOpen, setProjectMenuOpen, openProjectMenu, menuAction, runPendingMenuAction } =
    useProjectMenu();
  // ⌨️ szöveg-szerkesztés: a billentyűzet fölött a lapnak hely kell → mini-idővonal
  const keyboardVisible = useKeyboardVisible();
  const [missing, setMissing] = useState(false);
  const [missingMedia, setMissingMedia] = useState<MissingMedia[]>([]);
  const [relinking, setRelinking] = useState(false);
  // 🩹 hiányzó-média per-fájl helyreállítás-lista (CORE §2.8)
  const [missingSheetOpen, setMissingSheetOpen] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  // 🗂️ üres-állapot onboarding → forrás-sheet megnyitása (telefonon, ahol nincs dokk)
  const [showSource, setShowSource] = useState(false);
  const L = useLayout();
  const projectId = project?.id;

  usePlaybackClock();

  // ⚠️ a hookok sorrendje = az effektek sorrendje (a kilépő takarítás is ebben fut)
  const { collab, openCollabChat } = useEditorCollab(id, projectId);
  const [transferSize, setTransferSize] = useTransferAvailability(id, missingMedia.length);
  useForeignSourceToast(project, id, t);
  usePanelDeepLink(panel, projectId, id);
  useProjectLoader({ id, t, setMissing, setMissingMedia });
  useEditorWarmup(projectId);
  const { saveFailed, saveNow, saveAsCopy } = useAutosave({ dirty, project, t });

  const { relinkMissing, relinkOne, restoreFromTransfer, restoreFromRp } = createMissingMediaActions({
    t,
    missingMedia,
    relinking,
    setRelinking,
    setMissingMedia,
    setMissingSheetOpen,
    setTransferSize,
  });

  const cycleAspect = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const ids = aspectRatios.map((a) => a.id);
    const next = nextAspectRatio(ids, state.project.aspectRatio);
    state.dispatch({ type: 'SET_ASPECT', aspectRatio: next });
  };

  /**
   * Vissza: `router.back()` NEM csinál semmit, ha nincs előzmény (deep linkkel
   * vagy értesítésből nyitott szerkesztő) — ilyenkor a projektlistára lépünk,
   * hogy a gomb sose tűnjön halottnak. A kilépő-takarítás (mentés, lejátszás
   * leállítása, átmeneti módok nullázása) az unmount-effektben fut.
   */
  const goBack = () => {
    useEditorStore.getState().setPlaying(false);
    if (router.canGoBack()) {
      router.back();
    } else {
      // deep-linkkel/értesítésből nyitva nincs előzmény → a projektek listája (/studio)
      router.replace('/studio');
    }
  };

  if (missing) {
    return <MissingProjectView goBack={goBack} />;
  }

  const openCollabScreen = () => router.push(collabScreenPath(id, collab));

  const header = (
    <EditorHeader
      project={project}
      dirty={dirty}
      saveFailed={saveFailed}
      collab={collab}
      isCompact={L.isCompact}
      goBack={goBack}
      onOpenLineage={() => setLineageOpen(true)}
      openCollabChat={openCollabChat}
      openCollabScreen={openCollabScreen}
      cycleAspect={cycleAspect}
      openProjectMenu={openProjectMenu}
    />
  );

  // 🎬 üres projekt: tableten a forrás-dokk látszik (odamutatunk); telefonon a kártya megnyitja a sheetet
  const sourceDocked = L.editor.sourceBinWidth > 0;

  /**
   * Elrendezés méret-osztály szerint (lásd `@/constants/layout`, MOBILE-UI §6–7):
   *
   *  expanded — iPad fekvő/desktop. Teljes vágó-elrendezés: fejléc végig felül,
   *    alatta bal eszköz-RAIL | előnézet+transport | DOKKOLT inspector, legalul
   *    teljes szélességű idővonal. A panel és az idővonal EGYSZERRE látszik.
   *  medium+fekvő — telefon fekvőben: a videó kapja a bal oldalt, a vezérlők a
   *    jobb oszlopba kerülnek; nyitott panelnél az idővonal MINI-sorrá húzódik
   *    (nem tűnik el), alatta a panel teljes oszlop-magasságban.
   *  medium+álló / compact — függőleges rakás a `layoutBudget` szerint (vászon-
   *    garancia): Strip az eszköztár helyén, inline detentes Sheet, Focusban a
   *    vászon a teljes body. iPad-állóban (`keepTimeline`) az idővonal teljes marad.
   */
  const budget = layoutBudget({
    bodyHeight: bodyH,
    tier: surfaceTier ?? 'none',
    detent: panelDetent,
    trackScale: L.editor.trackScale,
    timelineFullHeight: timelineH,
    transportHeight: transportH,
    keepTimeline: L.sizeClass === 'medium',
    keyboardVisible,
  });
  const focus = surfaceTier === 'focus';
  const banners = (
    <EditorBanners
      id={id}
      project={project}
      missingMedia={missingMedia}
      relinking={relinking}
      collab={collab}
      tier={tier}
      sourceDocked={sourceDocked}
      setMissingSheetOpen={setMissingSheetOpen}
      openProjectMenu={openProjectMenu}
      setShowSource={setShowSource}
    />
  );

  return (
    // Fekvőben a notch / home-indicator az OLDALAKON van → ott az előnézet a
    // bevágás alá csúszna; ezért fekvő módban a bal/jobb szélt is insetteljük.
    // Állóban a bal/jobb inset 0, így ez nem változtat semmit.
    <UndoGestureArea>
    <SafeAreaView
      style={styles.container}
      edges={L.isLandscape ? ['top', 'bottom', 'left', 'right'] : ['top', 'bottom']}
    >
      {/* 🖨️ CORE K2/K5: a telefonos kép-render rejtett színpada (kép-hivatkozás frissítése, thumbnail,
          feed-poszter) — első gyerek, a szerkesztő eltakarja */}
      <RenderStage />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <NewerSchemaBanner />
        {/* 🔗 C2: a hivatkozott hang-projekt újabb verziója → egy koppintásos frissítés */}
        <LinkedUpdateBanner />
        <EditorLayoutBody
          L={L}
          focus={focus}
          panelVisible={panelVisible}
          surfaceTier={surfaceTier}
          budget={budget}
          header={header}
          banners={banners}
          setBodyH={setBodyH}
          setTransportH={setTransportH}
          setTimelineH={setTimelineH}
        />
        <ProjectMenuSheet
          visible={projectMenuOpen}
          onClose={() => setProjectMenuOpen(false)}
          onDismissed={runPendingMenuAction}
          isCompact={L.isCompact}
          aspectRatio={project?.aspectRatio}
          menuAction={menuAction}
          saveNow={saveNow}
          saveAsCopy={saveAsCopy}
          cycleAspect={cycleAspect}
          openCollabScreen={openCollabScreen}
        />
        <AudioLayer />
      </KeyboardAvoidingView>
      <ImageStudioModal />
      <AudioStudioModal />
      <RemixGraphModal
        visible={lineageOpen}
        onClose={() => setLineageOpen(false)}
        project={project}
      />
      {showSource ? (
        <SourceSheet
          onInsert={(a) => {
            useEditorStore.getState().insertSourceAsset(a);
            setShowSource(false);
          }}
          onClose={() => setShowSource(false)}
        />
      ) : null}
      {missingSheetOpen && project && missingMedia.length > 0 ? (
        <MissingMediaSheet
          project={project}
          missing={missingMedia}
          relinking={relinking}
          transferSizeBytes={transferSize}
          onRestoreFromTransfer={restoreFromTransfer}
          onRelinkAll={() => {
            void relinkMissing();
          }}
          onRelinkOne={(m) => {
            void relinkOne(m);
          }}
          onRestoreFromRp={restoreFromRp}
          onClose={() => setMissingSheetOpen(false)}
        />
      ) : null}
      {/* 📸 overlay-raszter host: az eszközön-render szöveg-PNG-it a preview-
          komponens snapshotja adja (pixel-hű) — láthatatlan, csak renderkor él */}
      <OverlayRasterHost />
      {/* ⏳ live-VOD feldolgozás-loader: a legfelső réteg, amíg a felvétel elérhető nem lesz */}
      <VodProcessingOverlay />
    </SafeAreaView>
    </UndoGestureArea>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
});
