import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ImageStudioBody } from '@/components/studio/image/ImageStudioBody';
import { palette } from '@/constants/editor';
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { backupProjectToCloud } from '@/lib/cloudSync';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🖼️ KÉP STÚDIÓ képernyő (`kind: 'image'` projekt). Vékony burkoló: betölti a
 * projektet a KÖZÖS `useEditorStore`-ba, a tényleges UI a store-vezérelt
 * `ImageStudioBody` (project mód). Ugyanez a törzs fut a videó-editorból nyíló
 * scoped Modalban is (egy kép-klip dokumentumán). Kilépéskor ment + felhő-backup.
 */
export default function ImageStudioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [loading, setLoading] = useState(true);

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
        saveProject(p).catch(() => {});
        backupProjectToCloud(p);
        useEditorStore.getState().closeProject();
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

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ImageStudioBody mode="project" title={project.name} onExit={() => router.back()} />
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
