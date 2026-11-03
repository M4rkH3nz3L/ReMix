import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioLayer } from '@/components/preview/AudioLayer';
import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { AudioStudioBody } from '@/components/studio/audio/AudioStudioBody';
import { palette } from '@/constants/editor';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { flushProjectSave } from '@/hooks/useProjectAutosave';
import { useStudioSession } from '@/hooks/useStudioSession';
import { StudioStatusBanners } from '@/components/studio/StudioStatusBanners';
import { audioProjectToVideo } from '@/lib/audioToVideo';
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
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { guardPro } from '@/store/paywallStore';
import { withCancellableProgress } from '@/store/progressStore';
import { useEditorStore } from '@/store/editorStore';
import { logCaught } from '@/lib/logCaught';

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

  usePlaybackClock();
  // 💾 A8: autosave, helyreállítás, hiányzó média, kilépés mentéssel (mint a kép- és videó-stúdióban)
  const { saveFailed, missing, relinking, relink, exit } = useStudioSession(id, loading);

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

  const sendToVideo = () => {
    // 🎧→🎬 a hang átvitele egy ÚJ videó-projektbe (a userhez képet ad)
    const vid = audioProjectToVideo(project, t('studio.audio.videoName', { name: project.name }), new Date().toISOString());
    // A13: előbb a hang-projekt, különben a kilépő mentéssel versenyezne
    flushProjectSave()
      .then(() => saveProject(vid))
      .then(() => router.replace(`/editor/${vid.id}`))
      .catch((caught) => { logCaught('app/studio/audio/[id].tsx:sendToVideo', caught); });
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
    return guardPro(
      () =>
        // A29: a ✕ a szerveren futó menetet is leállítja
        withCancellableProgress(t('studio.audio.exportRendering', { format: info.label }), async (report, signal) => {
          // A28: a fájl a projekt Export-mappájába kerül, a token nem megy URL-ben a böngészőnek
          const target = new File(projectExportDir(), audioExportFileName(project.name, format));
          const uri = await exportAudioToFile(mix, audioExportSettings(format, quality), target, report, signal);
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: info.mime, dialogTitle: t('studio.audio.exportSheet.shareTitle') });
          } else {
            Alert.alert(t('studio.audio.exportSheet.savedTitle'), t('studio.audio.exportSheet.savedBody', { name: target.name }));
          }
        }),
      (e) => {
        if (!isRenderCancelledError(e)) {
          Alert.alert(t('studio.export'), e.message);
        }
      }
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <AudioLayer />
      <StudioStatusBanners saveFailed={saveFailed} missingCount={missing.length} relinking={relinking} onRelink={() => void relink()} />
      <AudioStudioBody mode="project" title={project.name} onExit={exit} onExport={() => setExporting(true)} />
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
        />
      ) : null}
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
