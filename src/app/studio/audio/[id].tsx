import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioLayer } from '@/components/preview/AudioLayer';
import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { exportParts } from '@/components/studio/audio/exportParts';
import { AudioCheckSheet } from '@/components/studio/audio/AudioCheckSheet';
import { runAudioCheck } from '@/lib/audioCheckClient';
import type { CheckIssue, MixStats } from '@/lib/audioCheck';
import { AudioStudioBody } from '@/components/studio/audio/AudioStudioBody';
import { palette } from '@/constants/editor';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { flushProjectSave } from '@/hooks/useProjectAutosave';
import { useStudioSession } from '@/hooks/useStudioSession';
import { StudioStatusBanners } from '@/components/studio/StudioStatusBanners';
import { audioProjectToVideo } from '@/lib/audioToVideo';
import { sendMixdownToVideo } from '@/lib/linkedAssetClient';
import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { useActionMenu } from '@/store/actionMenuStore';
import { mixForExport } from '@/lib/audioExportMix';
import { exportAudioToFile, isRenderCancelledError } from '@/lib/render';
import {
  audioExportFileName,
  audioExportSettings,
  audioFormatInfo,
  type AudioExportFormat,
  type AudioExportQuality,
} from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { listProjects, loadEvents, loadProject, saveProject } from '@/lib/storage';
import type { Project } from '@/types/project';
import { guardPro, usePaywall } from '@/store/paywallStore';
import { useEntitlement } from '@/store/entitlementStore';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { withCancellableProgress } from '@/store/progressStore';
import { useEditorStore } from '@/store/editorStore';
import { logCaught } from '@/lib/logCaught';
import { registerDevAction } from '@/lib/devActions';
import { myMembership } from '@/lib/collab';
import { useLiveCollab } from '@/hooks/useLiveCollab';
import { cloudAvailable, isNetworkError } from '@/lib/backend';

/**
 * 🎧 HANG STÚDIÓ képernyő (`kind: 'audio'` projekt). Vékony burkoló: betölti a
 * projektet a KÖZÖS `useEditorStore`-ba, hajtja a rAF-órát + a `<AudioLayer />`
 * lejátszót, a tényleges UI a store-vezérelt `AudioStudioBody` (ugyanez fut a
 * videóból nyíló scoped Modalban is).
 */
export default function AudioStudioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [checkResult, setCheckResult] = useState<{ issues: CheckIssue[]; stats: MixStats | null } | null>(null);
  // a hook a korai return-ök előtt; az értéke lent, a projekt betöltése után kap függvényt
  const runCheckRef = useRef<() => Promise<CheckIssue[] | null>>(async () => null);
  const rangeIn = useEditorStore((s) => s.rangeIn);
  const rangeOut = useEditorStore((s) => s.rangeOut);
  const isPro = useEntitlement((s) => s.isPro());

  usePlaybackClock();
  // 🧪 a füstteszt az export-lapot is megnyithatja (csak __DEV__)
  useEffect(() => registerDevAction('audio.exportSheet', () => setExporting(true)), []);
  useEffect(() => registerDevAction('audio.runCheck', () => runCheckRef.current()), []);
  useEffect(() => registerDevAction('audio.closeCheck', () => setCheckResult(null)), []);
  // 💾 A8: autosave, helyreállítás, hiányzó média, kilépés mentéssel (mint a kép- és videó-stúdióban)
  const { saveFailed, missing, relinking, relink, exit } = useStudioSession(id, loading);

  // 👥 ÉLŐ collab a közvetlenül megnyitott hang-projekten is (eddig csak a videóból nyitott hang volt közös)
  const [collabOwner, setCollabOwner] = useState<string | null>(null);
  const projectId = project?.id;
  useEffect(() => {
    if (projectId === id) {
      myMembership(id)
        .then((m) => setCollabOwner(m?.ownerId ?? null))
        .catch((caught) => { logCaught('app/studio/audio/[id].tsx:membership', caught); });
    }
  }, [projectId, id]);
  useLiveCollab(id, collabOwner);

  // 🔊 néma-kapcsolónál is szóljon a lejátszás (mint a videó-editorban); a
  // felvétel ideiglenesen record-módra vált, de a ClipEditSheet/stúdió vissza is állítja
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch((caught) => { logCaught('app/studio/audio/[id].tsx:AudioStudioScreen', caught); });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([loadProject(id), loadEvents(id)])
      .then(([loaded, events]) => {
        if (!alive || !loaded) {
          setLoading(false);
          return;
        }
        useEditorStore.getState().loadProject(loaded, events);
        // 📊 CSWCR: a Hang Stúdió szerkeszti a projektet (a lánc egyik stúdiója)
        logCswcr({ type: 'edit', projectId: loaded.id, kind: studioKindOf(loaded.kind) });
        setLoading(false);
      })
      .catch((caught) => { logCaught('app/studio/audio/[id].tsx:AudioStudioScreen', caught); return alive && setLoading(false); });
    return () => {
      alive = false;
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        useEditorStore.getState().setPlaying(false);
        void flushProjectSave();
        useEditorStore.getState().closeProject();
      }
    };
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom', 'left', 'right']}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (!project || project.id !== id) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom', 'left', 'right']}>
        <Ionicons name="alert-circle-outline" size={40} color={palette.border} />
        <Text style={styles.missing}>{t('studio.notFound')}</Text>
        <Pressable style={styles.backPill} onPress={() => goBackOrHome()}>
          <Text style={styles.backPillText}>{t('studio.backToProjects')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const preview = () =>
    flushProjectSave()
      .then(() => router.push(`/player/${project.id}`))
      .catch((caught) => { logCaught('app/studio/audio/[id].tsx:preview', caught); });

  // 🩺 hangellenőrzés a telefonon (szerver nélkül) → az eredmény-lap
  const runCheck = async (): Promise<CheckIssue[] | null> => {
    const st = useEditorStore.getState();
    if (!st.project) return null;
    try {
      const r = await withCancellableProgress(t('studio.audio.check.working'), (report, signal) =>
        runAudioCheck(st.project!, { isTrackAudible: st.isTrackAudible, masterVolume: st.masterVolume, mutedTracks: st.mutedTracks, soloTracks: st.soloTracks }, report, signal)
      );
      setCheckResult(r);
      return r.issues;
    } catch (e) {
      logCaught('app/studio/audio/[id].tsx:runCheck', e);
      if (!isRenderCancelledError(e)) Alert.alert(t('studio.audio.check.title'), (e as Error).message);
      return null;
    }
  };
  runCheckRef.current = runCheck;

  // 🔗 C2 (ReMix.md 5.3): a hang HIVATKOZÁSKÉNT a videóba — a mixdown a telefonon, a videó a hang-projektre
  // mutat verzióval; a zene későbbi módosítása a videóban „Frissítés elérhető" → egy koppintás. A sávok
  // másolata (a régi mód) megmarad választható útként.
  const sendLinked = async (target: Project | null) => {
    try {
      // A13: előbb a hang-projekt mentése, különben a kilépő mentéssel versenyezne
      await flushProjectSave();
      const source = useEditorStore.getState().project ?? project;
      const vid = await withCancellableProgress(t('studio.audio.toVideo.rendering'), (report, signal) =>
        sendMixdownToVideo(source, target, { newName: t('studio.audio.videoName', { name: source.name }), onProgress: report, signal })
      );
      if (!vid) {
        Alert.alert(t('studio.audio.toVideo.title'), t('studio.audio.toVideo.silent'));
        return;
      }
      router.replace(`/editor/${vid.id}`);
    } catch (caught) {
      logCaught('app/studio/audio/[id].tsx:sendLinked', caught);
      if (!isRenderCancelledError(caught)) Alert.alert(t('studio.audio.toVideo.title'), (caught as Error).message);
    }
  };
  const pickVideoProject = async () => {
    const metas = (await listProjects()).filter((m) => (m.kind ?? 'video') === 'video' && m.id !== project.id).slice(0, 8);
    if (metas.length === 0) {
      Alert.alert(t('studio.audio.toVideo.title'), t('studio.audio.toVideo.noVideos'));
      return;
    }
    useActionMenu.getState().open(
      t('studio.audio.toVideo.pickTitle'),
      metas.map((m) => ({
        label: m.name,
        icon: 'videocam-outline',
        onPress: () => {
          void loadProject(m.id).then((p) => (p ? sendLinked(p) : undefined));
        },
      }))
    );
  };
  const copyToVideo = () => {
    // 🎧→🎬 a régi mód: a hang átvitele egy ÚJ videó-projektbe a sávok másolatával
    const vid = audioProjectToVideo(project, t('studio.audio.videoName', { name: project.name }), new Date().toISOString());
    flushProjectSave()
      .then(() => saveProject(vid))
      .then(() => {
        // 📊 CSWCR: átadás másolattal (a link-arány nevezője)
        logCswcr({ type: 'handoff', via: 'copy', projectId: project.id, kind: studioKindOf(project.kind), toProjectId: vid.id });
        router.replace(`/editor/${vid.id}`);
      })
      .catch((caught) => { logCaught('app/studio/audio/[id].tsx:sendToVideo', caught); });
  };
  const sendToVideo = () => {
    useActionMenu.getState().open(t('studio.audio.toVideo.title'), [
      { label: t('studio.audio.toVideo.newLinked'), icon: 'link-outline', onPress: () => void sendLinked(null) },
      { label: t('studio.audio.toVideo.existing'), icon: 'film-outline', onPress: () => void pickVideoProject() },
      { label: t('studio.audio.toVideo.copyTracks'), icon: 'copy-outline', onPress: copyToVideo },
    ]);
  };

  const downloadAudio = (format: AudioExportFormat, quality: AudioExportQuality) => {
    setExporting(false);
    // A15: az export azt adja, amit hallasz
    const store = useEditorStore.getState();
    const mix = mixForExport(project, store.isTrackAudible, store.masterVolume);
    if (!mix) {
      Alert.alert(t('studio.export'), t('studio.audio.exportSilent'));
      return Promise.resolve();
    }
    const info = audioFormatInfo(format);
    // A26: Free — és felhő nélkül (nincs net / ebben a buildben nincs felhő) bárki — a WAV a telefonon készül
    const phoneExport = (note?: string) =>
      withCancellableProgress(t('studio.audio.exportRendering', { format: 'WAV' }), async (report, signal) => {
        if (note) Alert.alert(t('studio.export'), note);
        const target = new File(projectExportDir(), audioExportFileName(project.name, 'wav'));
        const { uri, unsupported } = await exportOfflineWav(mix, target, report, signal);
        logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });
        if (unsupported.length > 0) {
          await new Promise<void>((resolve) =>
            Alert.alert(
              t('studio.audio.offline.unsupportedTitle'),
              t('studio.audio.offline.unsupportedBody', { list: unsupported.map((u) => t(`studio.audio.offline.feature.${u}`)).join(', ') }),
              [{ text: t('common.ok'), onPress: () => resolve() }]
            )
          );
        }
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'audio/wav', dialogTitle: t('studio.audio.exportSheet.shareTitle') });
        } else {
          Alert.alert(t('studio.audio.exportSheet.savedTitle'), t('studio.audio.exportSheet.savedBody', { name: target.name }));
        }
      }).catch((e: Error) => {
        logCaught('app/studio/audio/[id].tsx:offlineExport', e);
        if (!isRenderCancelledError(e)) {
          Alert.alert(t('studio.export'), e.message);
        }
      });
    if (!useEntitlement.getState().isPro() || !cloudAvailable()) {
      return phoneExport();
    }
    return guardPro(
      () =>
        // A29: a ✕ a szerveren futó menetet is leállítja
        withCancellableProgress(t('studio.audio.exportRendering', { format: info.label }), async (report, signal) => {
          // A28: a fájl a projekt Export-mappájába kerül, a token nem megy URL-ben a böngészőnek
          const target = new File(projectExportDir(), audioExportFileName(project.name, format));
          const uri = await exportAudioToFile(mix, audioExportSettings(format, quality), target, report, signal);
          logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: info.mime, dialogTitle: t('studio.audio.exportSheet.shareTitle') });
          } else {
            Alert.alert(t('studio.audio.exportSheet.savedTitle'), t('studio.audio.exportSheet.savedBody', { name: target.name }));
          }
        }),
      (e) => {
        if (isRenderCancelledError(e)) return;
        // 📱 a szerver nem érhető el (nincs net): a telefonos WAV a tartalék, nem hibaüzenet
        if (isNetworkError(e)) {
          void phoneExport(t('studio.audio.exportSheet.phoneFallback'));
          return;
        }
        Alert.alert(t('studio.export'), e.message);
      }
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <AudioLayer />
      <StudioStatusBanners saveFailed={saveFailed} missingCount={missing.length} relinking={relinking} onRelink={() => void relink()} />
      <AudioStudioBody mode="project" title={project.name} onExit={exit} onExport={() => setExporting(true)} onRequestCheck={() => void runCheck()} />
      {exporting ? (
        <AudioExportSheet
          onClose={() => setExporting(false)}
          onPreview={() => {
            setExporting(false);
            void preview();
          }}
          onUseInVideo={() => {
            setExporting(false);
            sendToVideo();
          }}
          onDownload={(format, quality) => void downloadAudio(format, quality)}
          onDevice={!isPro || !cloudAvailable()}
          onProRequired={() => {
            setExporting(false);
            usePaywall.getState().open('cloudRender');
          }}
          range={rangeIn != null && rangeOut != null && rangeOut > rangeIn ? { from: rangeIn, to: rangeOut } : null}
          onCheck={() => {
            setExporting(false);
            void runCheck();
          }}
          onExportParts={(scope, bits) => {
            setExporting(false);
            exportParts(project, scope, bits, t).catch((e: Error) => {
              logCaught('app/studio/audio/[id].tsx:exportParts', e);
              if (!isRenderCancelledError(e)) Alert.alert(t('studio.export'), e.message);
            });
          }}
        />
      ) : null}
      {checkResult ? <AudioCheckSheet issues={checkResult.issues} stats={checkResult.stats} onClose={() => setCheckResult(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#05060a' },
  missing: { color: palette.textDim, fontSize: 14 },
  backPill: { marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 16, paddingVertical: 8 },
  backPillText: { color: palette.text, fontSize: 14, fontWeight: '700' },
});
