import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioLayer } from '@/components/preview/AudioLayer';
import { AudioStudioBody } from '@/components/studio/audio/AudioStudioBody';
import { palette } from '@/constants/editor';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { flushProjectSave } from '@/hooks/useProjectAutosave';
import { useStudioSession } from '@/hooks/useStudioSession';
import { StudioStatusBanners } from '@/components/studio/StudioStatusBanners';
import { audioProjectToVideo } from '@/lib/audioToVideo';
import { exportAudioFile } from '@/lib/render';
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
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

  const useInVideo = () => {
    // 🎧→🎬 a hang átvitele egy ÚJ videó-projektbe (a userhez képet ad)
    const vid = audioProjectToVideo(project, t('studio.audio.videoName', { name: project.name }), new Date().toISOString());
    // A13: előbb a hang-projekt, különben a kilépő mentéssel versenyezne
    flushProjectSave()
      .then(() => saveProject(vid))
      .then(() => router.replace(`/editor/${vid.id}`))
      .catch((caught) => { logCaught('app/studio/audio/[id].tsx:useInVideo', caught); });
  };

  const downloadAudio = (format: 'wav' | 'mp3' | 'aac' | 'flac' | 'opus') =>
    guardPro(
      () =>
        withProgress(t('studio.audio.exportRendering', { format: format.toUpperCase() }), (report) =>
          exportAudioFile(project, format, report).then((url) => {
            Linking.openURL(url).catch((caught) => { logCaught('app/studio/audio/[id].tsx:downloadAudio', caught); });
          })
        ),
      (e) => Alert.alert(t('studio.export'), e.message)
    );

  const openDownload = () =>
    Alert.alert(t('studio.audio.exportDownload'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: 'MP3', onPress: () => downloadAudio('mp3') },
      { text: 'WAV', onPress: () => downloadAudio('wav') },
      { text: 'AAC (M4A)', onPress: () => downloadAudio('aac') },
      { text: 'FLAC', onPress: () => downloadAudio('flac') },
      { text: 'Opus (OGG)', onPress: () => downloadAudio('opus') },
    ]);

  const openExport = () =>
    Alert.alert(t('studio.export'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.audio.exportPreview'), onPress: preview },
      { text: t('studio.audio.exportToVideo'), onPress: useInVideo },
      { text: t('studio.audio.exportDownload'), onPress: openDownload },
    ]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <AudioLayer />
      <StudioStatusBanners saveFailed={saveFailed} missingCount={missing.length} relinking={relinking} onRelink={() => void relink()} />
      <AudioStudioBody mode="project" title={project.name} onExit={exit} onExport={openExport} />
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
