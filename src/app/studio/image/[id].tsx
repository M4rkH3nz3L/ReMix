import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ImageStudioBody } from '@/components/studio/image/ImageStudioBody';
import { palette } from '@/constants/editor';
import { flushProjectSave, useProjectAutosave } from '@/hooks/useProjectAutosave';
import { pullProject } from '@/lib/cloudSync';
import { mediaRemoteMap, restoreMissingMedia } from '@/lib/mediaSync';
import { loadEvents, loadProject } from '@/lib/storage';
import { findMissingMedia, pickRelinkPairs, relinkCommandsFor, type MissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';

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
  // 💾 I1: autosave + recovery + háttérbe lépéskori mentés (a videó-editor mintájára)
  const { saveFailed } = useProjectAutosave(id, !loading);

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
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        void flushProjectSave();
        useEditorStore.getState().closeProject();
      }
    };
  }, [id, adopted]);

  // 🗄️ I3: hiányzó rétegfájlok — előbb automatikus visszatöltés a szerver-másolatból,
  // ami így sem jön vissza, azt a banner jelzi (nem marad ki csendben az exportból)
  const [missing, setMissing] = useState<MissingMedia[]>([]);
  const [relinking, setRelinking] = useState(false);
  useEffect(() => {
    if (loading || Platform.OS === 'web') {
      return;
    }
    let alive = true;
    void (async () => {
      const proj = useEditorStore.getState().project;
      if (!proj || proj.id !== id || findMissingMedia(proj).length === 0) {
        return;
      }
      let remote = mediaRemoteMap(proj);
      if (Object.keys(remote).length === 0) {
        const cloud = await pullProject(proj.id).catch(() => null);
        remote = cloud ? mediaRemoteMap(cloud) : remote;
      }
      const { pairs } = await restoreMissingMedia(proj, remote);
      const store = useEditorStore.getState();
      if (!alive || store.project?.id !== id) {
        return;
      }
      if (pairs.length > 0) {
        store.applyBatch(relinkCommandsFor(store.project, pairs), 'system');
      }
      setMissing(findMissingMedia(useEditorStore.getState().project!));
    })();
    return () => {
      alive = false;
    };
  }, [loading, id]);

  const relink = async () => {
    if (relinking) {
      return;
    }
    setRelinking(true);
    try {
      const pairs = await pickRelinkPairs(missing);
      const store = useEditorStore.getState();
      if (store.project?.id !== id) {
        return;
      }
      if (pairs.length > 0) {
        store.applyBatch(relinkCommandsFor(store.project, pairs), 'user');
      }
      setMissing(findMissingMedia(useEditorStore.getState().project!));
    } finally {
      setRelinking(false);
    }
  };

  // 🚪 I8: kilépés előtt azonnali mentés; ha nem sikerül, a user dönt (nem vész el csendben)
  const exit = () => {
    void flushProjectSave().then((ok) => {
      if (ok) {
        goBackOrHome();
        return;
      }
      Alert.alert(t('studio.image.unsaved.title'), t('studio.image.unsaved.message'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('studio.image.unsaved.leave'), style: 'destructive', onPress: () => goBackOrHome() },
      ]);
    });
  };

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
      {saveFailed ? (
        <View style={styles.saveFailed} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={14} color="#ffd166" />
          <Text style={styles.saveFailedText}>{t('studio.image.unsaved.banner')}</Text>
        </View>
      ) : null}
      {missing.length > 0 ? (
        <Pressable style={styles.missingBanner} onPress={() => void relink()} accessibilityRole="button">
          <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
          <Text style={styles.missingText}>
            {relinking ? t('editorScreen.relinking') : t('editorScreen.missingMedia', { count: missing.length })}
          </Text>
        </Pressable>
      ) : null}
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
  saveFailed: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,209,102,0.12)' },
  missingBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,92,92,0.12)' },
  missingText: { color: palette.text, fontSize: 12, fontWeight: '600', flex: 1 },
  saveFailedText: { color: '#ffd166', fontSize: 12, fontWeight: '600', flex: 1 },
});
