import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ImageStudioBody } from '@/components/studio/image/ImageStudioBody';
import { palette } from '@/constants/editor';
import { flushProjectSave } from '@/hooks/useProjectAutosave';
import { useStudioSession } from '@/hooks/useStudioSession';
import { StudioStatusBanners } from '@/components/studio/StudioStatusBanners';
import { loadEvents, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 🖼️ KÉP STÚDIÓ képernyő (`kind: 'image'` projekt). Vékony burkoló: betölti a
 * projektet a KÖZÖS `useEditorStore`-ba, a tényleges UI a store-vezérelt
 * `ImageStudioBody` (project mód). Ugyanez a törzs fut a videó-editorból nyíló
 * scoped Modalban is (egy kép-klip dokumentumán). Autosave + recovery (I1), kilépéskor
 * azonnali mentés + felhő-backup.
 */
export default function ImageStudioScreen() {
  // `doc` = a nyitandó lap (pl. az album-borító ImageDoc-ja) — különben az első lap
  const { id, doc } = useLocalSearchParams<{ id: string; doc?: string }>();
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  // 🎵 I7: ha a projekt MÁR a store-ban van (pl. az Audio Stúdió borító-szerkesztéséből
  // nyitva), NEM töltjük újra lemezről és kilépéskor NEM zárjuk be — az alatta lévő
  // stúdió a nem mentett munkájával és undo-előzményével együtt érintetlen marad
  const [adopted] = useState(() => useEditorStore.getState().project?.id === id);
  const [loading, setLoading] = useState(!adopted);
  // 💾 I1, I3, I8: autosave, helyreállítás, hiányzó média, kilépés mentéssel
  const { saveFailed, missing, relinking, relink, exit } = useStudioSession(id, loading);

  useEffect(() => {
    if (adopted) {
      return () => {
        void flushProjectSave();
      };
    }
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
      .catch((caught) => { logCaught('app/studio/image/[id].tsx:ImageStudioScreen', caught); return alive && setLoading(false); });
    return () => {
      alive = false;
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        void flushProjectSave();
        useEditorStore.getState().closeProject();
      }
    };
  }, [id, adopted]);

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

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <StudioStatusBanners saveFailed={saveFailed} missingCount={missing.length} relinking={relinking} onRelink={() => void relink()} />
      <ImageStudioBody mode="project" title={project.name} initialPageId={doc} onExit={exit} />
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
