import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioLayer } from '@/components/preview/AudioLayer';
import { AudioStudioBody } from '@/components/studio/audio/AudioStudioBody';
import { palette } from '@/constants/editor';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { audioProjectToVideo } from '@/lib/audioToVideo';
import { exportAudioFile } from '@/lib/render';
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import { useEditorStore } from '@/store/editorStore';

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
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        useEditorStore.getState().setPlaying(false);
        saveProject(p).catch(() => {});
      }
    };
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (!project || project.id !== id) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <Ionicons name="alert-circle-outline" size={40} color={palette.border} />
        <Text style={styles.missing}>{t('studio.notFound')}</Text>
        <Pressable style={styles.backPill} onPress={() => router.back()}>
          <Text style={styles.backPillText}>{t('studio.backToProjects')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const preview = () =>
    saveProject(project)
      .then(() => router.push(`/player/${project.id}`))
      .catch(() => {});

  const useInVideo = () => {
    // 🎧→🎬 a hang átvitele egy ÚJ videó-projektbe (a userhez képet ad)
    const vid = audioProjectToVideo(project, t('studio.audio.videoName', { name: project.name }), new Date().toISOString());
    saveProject(vid)
      .then(() => router.replace(`/editor/${vid.id}`))
      .catch(() => {});
  };

  const downloadAudio = (format: 'wav' | 'mp3' | 'aac' | 'flac') =>
    guardPro(
      () =>
        withProgress(t('studio.audio.exportRendering', { format: format.toUpperCase() }), (report) =>
          exportAudioFile(project, format, report).then((url) => {
            Linking.openURL(url).catch(() => {});
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
    ]);

  const openExport = () =>
    Alert.alert(t('studio.export'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.audio.exportPreview'), onPress: preview },
      { text: t('studio.audio.exportToVideo'), onPress: useInVideo },
      { text: t('studio.audio.exportDownload'), onPress: openDownload },
    ]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <AudioLayer />
      <AudioStudioBody mode="project" title={project.name} onExit={() => router.back()} onExport={openExport} />
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
