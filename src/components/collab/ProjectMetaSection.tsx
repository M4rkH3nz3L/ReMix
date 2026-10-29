import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProjectSyncSection } from '@/components/storage/ProjectSyncSection';
import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { logProjectActivity } from '@/lib/chat';
import { backupProjectToCloud } from '@/lib/cloudSync';
import { applyCommand } from '@/lib/commands';
import { FPS_OPTIONS } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { pickImage } from '@/lib/media';
import { activeProjectFolder, setActiveProjectFolder } from '@/lib/projectFolderClient';
import { saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AspectRatio, Asset, Project } from '@/types/project';

/**
 * ⚙️ Projekt-beállítások (tulaj): MINDEN, amit a létrehozásnál megadott,
 * itt módosítható — név, képarány, fps, SEO (leírás/hashtagek/kulcsszavak).
 * A változások a pure `applyCommand` reducerrel készülnek (ugyanaz az út, mint
 * az editorban), mentés + felhő-backup + aktivitás-napló a projekt-szobába.
 */

const ASPECTS: AspectRatio[] = ['9:16', '16:9', '1:1'];

export function ProjectMetaSection({
  ownerId,
  project,
  onSaved,
}: {
  ownerId: string;
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(project.name);
  const [aspect, setAspect] = useState<AspectRatio>(project.aspectRatio);
  const [fps, setFps] = useState<number>(project.fps ?? 30);
  const [seoDescription, setSeoDescription] = useState(project.seo?.description ?? '');
  const [seoHashtags, setSeoHashtags] = useState((project.seo?.hashtags ?? []).join(' '));
  const [seoKeywords, setSeoKeywords] = useState((project.seo?.keywords ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverAsset = project.coverAssetId ? project.assets.find((a) => a.id === project.coverAssetId) : undefined;
  const isAudio = (project.kind ?? 'video') === 'audio';

  /**
   * 🖼️ Borítókép (hangnál album-borító) — AZONNAL mentődik. Ha a projekt épp nyitva van
   * a szerkesztőben, a parancs a store-on megy (visszavonható, és a szerkesztő nem írja
   * felül visszatéréskor); különben a pure reducerrel, mint a többi beállítás.
   */
  const applyCover = async (asset: Asset | null) => {
    const store = useEditorStore.getState();
    let next: Project | null;
    if (store.project?.id === project.id) {
      next = store.dispatch({ type: 'SET_PROJECT_COVER', asset }, 'user') ? useEditorStore.getState().project : null;
    } else {
      next = applyCommand(project, { type: 'SET_PROJECT_COVER', asset });
    }
    if (!next) {
      return;
    }
    await saveProject(next);
    await backupProjectToCloud(next).catch(() => {});
    void logProjectActivity(ownerId, next.id, `🖼️ ${t(asset ? 'lib.commands.setCover' : 'lib.commands.clearCover')}`);
    onSaved(next);
  };

  const pickCover = async () => {
    setCoverBusy(true);
    const prevFolder = activeProjectFolder();
    try {
      // a pickImage az AKTÍV projekt-mappába másol → a borító a projekt SAJÁT mappájába kerül
      setActiveProjectFolder(project.folder);
      const picked = await pickImage();
      if (picked) {
        await applyCover({ id: makeId('ast'), kind: 'image', uri: picked.uri, provider: 'local', name: 'cover' });
      }
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setActiveProjectFolder(prevFolder);
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    setCoverBusy(true);
    try {
      await applyCover(null);
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setCoverBusy(false);
    }
  };

  const dirty =
    name !== project.name ||
    aspect !== project.aspectRatio ||
    fps !== (project.fps ?? 30) ||
    seoDescription !== (project.seo?.description ?? '') ||
    seoHashtags !== (project.seo?.hashtags ?? []).join(' ') ||
    seoKeywords !== (project.seo?.keywords ?? []).join(', ');

  const save = async () => {
    setBusy(true);
    try {
      // a meta-váltás a PURE reducer útján megy (mint az editor-parancsok)
      let next = project;
      const trimmed = name.trim();
      if (trimmed && trimmed !== next.name) {
        next = applyCommand(next, { type: 'RENAME_PROJECT', name: trimmed }) ?? next;
      }
      if (aspect !== next.aspectRatio) {
        next = applyCommand(next, { type: 'SET_ASPECT', aspectRatio: aspect }) ?? next;
      }
      if (fps !== (next.fps ?? 30)) {
        next = applyCommand(next, { type: 'SET_FPS', fps }) ?? next;
      }
      const seo = {
        title: project.seo?.title ?? trimmed,
        description: seoDescription.trim(),
        hashtags: seoHashtags
          .split(/[\s,#]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        keywords: seoKeywords
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      next = { ...next, seo };
      await saveProject(next);
      await backupProjectToCloud(next).catch(() => {});
      void logProjectActivity(ownerId, next.id, `⚙️ ${t('collab.settings.logUpdated')}`);
      onSaved(next);
      Alert.alert(t('collab.settings.title'), t('collab.settings.saved'));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('collab.settings.title')}</Text>
      {/* 🖼️ borítókép / album-borító — a projekt előnézeti képe a listában */}
      <Text style={styles.label}>{t(isAudio ? 'collab.settings.coverAudio' : 'collab.settings.cover')}</Text>
      <View style={styles.coverRow}>
        {coverAsset ? (
          <Image source={{ uri: coverAsset.uri }} style={styles.cover} contentFit="cover" />
        ) : (
          <View style={[styles.cover, styles.coverEmpty]} />
        )}
        <View style={styles.coverActions}>
          <Text style={styles.hint}>{t('collab.settings.coverHint')}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={t(coverAsset ? 'collab.settings.coverChange' : 'collab.settings.coverPick')}
              active={false}
              onPress={() => {
                if (!coverBusy) void pickCover();
              }}
            />
            {coverAsset ? (
              <Chip
                label={t('collab.settings.coverRemove')}
                active={false}
                onPress={() => {
                  if (!coverBusy) void removeCover();
                }}
              />
            ) : null}
          </View>
        </View>
      </View>
      <Text style={styles.label}>{t('collab.settings.name')}</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />
      <Text style={styles.label}>{t('collab.settings.aspect')}</Text>
      <View style={styles.chipRow}>
        {ASPECTS.map((a) => (
          <Chip key={a} label={a} active={aspect === a} onPress={() => setAspect(a)} />
        ))}
      </View>
      <Text style={styles.label}>{t('collab.settings.fps')}</Text>
      <View style={styles.chipRow}>
        {FPS_OPTIONS.map((f) => (
          <Chip key={f} label={String(f)} active={fps === f} onPress={() => setFps(f)} />
        ))}
      </View>
      <Text style={styles.label}>{t('collab.settings.seoDescription')}</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={seoDescription}
        onChangeText={setSeoDescription}
        multiline
      />
      <Text style={styles.label}>{t('collab.settings.seoHashtags')}</Text>
      <TextInput
        style={styles.input}
        value={seoHashtags}
        onChangeText={setSeoHashtags}
        autoCapitalize="none"
      />
      <Text style={styles.label}>{t('collab.settings.seoKeywords')}</Text>
      <TextInput
        style={styles.input}
        value={seoKeywords}
        onChangeText={setSeoKeywords}
        autoCapitalize="none"
      />
      <PrimaryButton
        label={t('common.save')}
        icon="save-outline"
        onPress={() => {
          void save();
        }}
        disabled={busy || !dirty}
      />
      {/* 📁☁️ a projekt telefonos mappája + szinkron a ReMix Storage-ba */}
      <Text style={styles.label}>{t('storage.projectStorage')}</Text>
      <ProjectSyncSection projectId={project.id} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  label: { color: palette.textDim, fontSize: 12, fontWeight: '600', marginTop: 2 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  coverRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cover: { width: 72, height: 72, borderRadius: 12, backgroundColor: palette.surfaceHigh },
  coverEmpty: { borderWidth: 1, borderColor: palette.border, borderStyle: 'dashed' },
  coverActions: { flex: 1, gap: 8 },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 17 },
});
