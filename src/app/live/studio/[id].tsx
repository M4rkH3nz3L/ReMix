import { useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { UndoGestureArea } from '@/components/UndoGestureArea';
import { LivePanelList } from '@/components/live/LivePanelList';
import { AddRtmpModal } from '@/components/live/studio/AddRtmpModal';
import { LiveCanvas } from '@/components/live/studio/LiveCanvas';
import {
  LiveStudioLoadError,
  LiveStudioLoading,
  LiveStudioTopBar,
  StartStreamBar,
} from '@/components/live/studio/LiveStudioChrome';
import { MixerPanel } from '@/components/live/studio/MixerPanel';
import { ScenesPanel } from '@/components/live/studio/ScenesPanel';
import { SourcesPanel } from '@/components/live/studio/SourcesPanel';
import { DestinationsPanel, MultistreamPanel, RecordPanel } from '@/components/live/studio/StreamConfigPanels';
import { createRtmpActions, createStudioActions } from '@/components/live/studio/liveStudioActions';
import { shared } from '@/components/live/studio/liveStudioStyles';
import { sizeClassFor } from '@/constants/layout';
import { normalizePanelOrder, type LivePanelId } from '@/lib/livePanels';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import {
  activeScene as getActiveScene,
  repairLiveDoc,
  setTitle as setDocTitle,
  updateSource,
} from '@/lib/liveDoc';
import { listDestinations, type LiveDestinationRow } from '@/lib/liveDestinations';
import { aspectValue, canvasMaxHeight, flipFacing, primaryCameraIdOf } from '@/lib/liveStudioOps';
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { LiveDoc, LiveMixer, LiveSource } from '@/types/live';
import { logCaught } from '@/lib/logCaught';

/**
 * 🎥 Live Studio (élő ELŐTTI szerkesztő): jelenetek/források, célok, rögzítés, mixer,
 * multistream RTMP-célok, majd „Start streaming” → /live/[id]. A gyökér a hookokat
 * (eredeti sorrendben), a betöltést és a panel-összerakást tartja; a részek a
 * src/components/live/studio/ alatt, a számítások a src/lib/liveStudioOps.ts-ben.
 */
export default function LiveStudioScreen() {
  // szándékos: a bontás előtt a gyökér kimaradt a fordítóból (try/catch-es onStart) —
  // a memoizálás bekapcsolása viselkedés-változás, külön döntés
  'use no memo';
  const { t } = useTranslation();
  const { height: winH, width: winW } = useWindowDimensions();
  // tableten a vászon és a panelek egymás mellett
  const wide = sizeClassFor(winW, winH) !== 'compact';
  const savedPanels = useEditorPrefs((s) => s.livePanels);
  const setLivePanels = useEditorPrefs((s) => s.setLivePanels);
  const panelOrder = useMemo(() => normalizePanelOrder(savedPanels), [savedPanels]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useEditorStore((s) => s.project);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasW, setCanvasW] = useState(0);
  const [titleDraft, setTitleDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  // 🎥 multistream RTMP-célok (live_destinations) + „Add RTMP" modal
  const [dests, setDests] = useState<LiveDestinationRow[]>([]);
  const [rtmpOpen, setRtmpOpen] = useState(false);
  const [rtmpLabel, setRtmpLabel] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [rtmpKey, setRtmpKey] = useState('');
  // 🎥 élő kamera-előnézet (expo-camera) — a Studio élő ELŐTTI, így a kamera szabad
  const [camPerm, requestCam] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  // a Go-live előtt az előnézet kamerája elengedve (L40)
  const [releasingCamera, setReleasingCamera] = useState(false);

  const loadDests = useCallback(() => {
    listDestinations()
      .then(setDests)
      .catch((caught) => { logCaught('app/live/studio/[id].tsx:loadDests', caught); });
  }, []);

  // a projekt betöltése a közös store-ba (mint a többi stúdió-route)
  useEffect(() => {
    let active = true;
    Promise.all([loadProject(String(id)), loadEvents(String(id))])
      .then(([loaded, events]) => {
        if (!active) return;
        if (!loaded) {
          setLoadError(true);
          return;
        }
        // 🩹 L21: hibás / hiányos live-doc → helyreállítva (eddig végtelen spinner)
        const { doc: liveDoc, repaired } = repairLiveDoc(loaded.live, loaded.name, () => makeId('live'));
        const project = repaired ? { ...loaded, live: liveDoc } : loaded;
        if (repaired) {
          void saveProject(project).catch((caught) => { logCaught('app/live/studio/[id].tsx:LiveStudioScreen', caught); });
        }
        useEditorStore.getState().loadProject(project, events);
        setTitleDraft(liveDoc.title ?? loaded.name);
        if (liveDoc.cameraFacing) setFacing(liveDoc.cameraFacing);
      })
      .catch((caught) => { logCaught('app/live/studio/[id].tsx:LiveStudioScreen', caught); return active && setLoadError(true); });
    loadDests();
    return () => {
      active = false;
    };
  }, [id, loadDests]);

  const live = project?.live ?? null;

  const commit = useCallback((next: LiveDoc, label?: string) => {
    useEditorStore.getState().dispatch({ type: 'SET_LIVE_DOC', doc: next, label });
  }, []);

  // 🎚️ mixer-mutáció → új LiveDoc → SET_LIVE_DOC (undo-zható)
  const commitMixer = useCallback(
    (nextMixer: LiveMixer) => {
      if (live) {
        commit({ ...live, mixer: nextMixer }, 'mixer');
      }
    },
    [live, commit],
  );

  const scene = useMemo(() => (live ? getActiveScene(live) : undefined), [live]);
  const selected: LiveSource | null = useMemo(
    () => scene?.sources.find((s) => s.id === selectedId) ?? null,
    [scene, selectedId]
  );
  // 🎥 egyszerre csak EGY élő kamera (iOS) → az első látható kamera-forrás kap képet
  const primaryCameraId = useMemo(
    () => primaryCameraIdOf(scene),
    [scene]
  );
  // belépéskor elkérjük a kamera-engedélyt (a preview-hoz) — ha már eldőlt, no-op
  useEffect(() => {
    if (!camPerm?.granted) {
      requestCam();
    }
  }, [camPerm?.granted, requestCam]);

  if (loadError) {
    return <LiveStudioLoadError />;
  }

  if (!project || !live) {
    return <LiveStudioLoading />;
  }

  const aspect = aspectValue(project.aspectRatio);

  const { onAddSource, onAddScene, onCancel, onStart } = createStudioActions({
    id,
    project,
    live,
    scene,
    titleDraft,
    facing,
    commit,
    t,
    setAdding,
    setStarting,
    setReleasingCamera,
  });
  const { onToggleDest, onRemoveDest, onSubmitRtmp } = createRtmpActions({
    rtmpLabel,
    rtmpUrl,
    rtmpKey,
    setRtmpLabel,
    setRtmpUrl,
    setRtmpKey,
    setRtmpOpen,
    loadDests,
    t,
  });

  // 🧩 a szakaszok panelek: tableten a vászon mellett állnak, és ujjal átrendezhetők
  const panels: Partial<Record<LivePanelId, ReactNode>> = {
    scenes: <ScenesPanel live={live} commit={commit} onAddScene={onAddScene} />,
    sources: (
      <SourcesPanel
        live={live}
        scene={scene}
        selected={selected}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        adding={adding}
        setAdding={setAdding}
        commit={commit}
        onAddSource={onAddSource}
      />
    ),
    destinations: <DestinationsPanel live={live} commit={commit} />,
    record: <RecordPanel live={live} commit={commit} />,
    mixer: live.mixer ? <MixerPanel live={live} commitMixer={commitMixer} /> : null,
    multistream: (
      <MultistreamPanel
        dests={dests}
        onOpenRtmp={() => setRtmpOpen(true)}
        onToggleDest={onToggleDest}
        onRemoveDest={onRemoveDest}
      />
    ),
  };
  const canvasBlock = (
    <>
        {/* program-vászon */}
        <View style={styles.canvasWrap} onLayout={(e) => setCanvasW(e.nativeEvent.layout.width)}>
          {canvasW > 0 && (
            <LiveCanvas
              doc={live}
              width={canvasW}
              aspect={aspect}
              maxHeight={canvasMaxHeight(wide, winH)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMoveSource={(sourceId, transform) => {
                const sceneId = getActiveScene(live)?.id;
                if (sceneId) {
                  commit(updateSource(live, sceneId, sourceId, { transform }), 'move-source');
                }
              }}
              facing={facing}
              cameraGranted={!!camPerm?.granted}
              primaryCameraId={primaryCameraId}
              onRequestCamera={() => requestCam()}
              onFlip={() => setFacing(flipFacing)}
              releasing={releasingCamera}
            />
          )}
        </View>

    </>
  );
  const panelList = <LivePanelList order={panelOrder} panels={panels} onOrder={setLivePanels} />;

  return (
    <UndoGestureArea>
    <SafeAreaView style={shared.container} edges={['top', 'bottom']}>
      {/* fejléc */}
      <LiveStudioTopBar
        onCancel={onCancel}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        onTitleEnd={() => commit(setDocTitle(live, titleDraft))}
      />

      {wide ? (
        <View style={styles.desk}>
          <ScrollView style={styles.deskCanvas} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {canvasBlock}
          </ScrollView>
          <ScrollView style={styles.deskPanels} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {panelList}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {canvasBlock}
          {panelList}
        </ScrollView>
      )}

      {/* akció-sáv */}
      <StartStreamBar starting={starting} onStart={onStart} />

      {/* 🎥 Add RTMP target modal */}
      <AddRtmpModal
        open={rtmpOpen}
        setOpen={setRtmpOpen}
        rtmpLabel={rtmpLabel}
        setRtmpLabel={setRtmpLabel}
        rtmpUrl={rtmpUrl}
        setRtmpUrl={setRtmpUrl}
        rtmpKey={rtmpKey}
        setRtmpKey={setRtmpKey}
        onSubmit={onSubmitRtmp}
      />
    </SafeAreaView>
    </UndoGestureArea>
  );
}

const styles = StyleSheet.create({
  body: { padding: 12, gap: 12, paddingBottom: 24 },
  desk: { flex: 1, flexDirection: 'row' },
  deskCanvas: { flex: 3 },
  deskPanels: { flex: 2, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.border },
  canvasWrap: { width: '100%' },
});
