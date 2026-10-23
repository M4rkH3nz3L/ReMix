import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { extractMediaUriEntries } from '@/lib/mediaGc';
import { restoreSelectedMedia } from '@/lib/mediaSync';
import { extractRpMediaSelected, listRpMediaEntries } from '@/lib/rpFile';
import { relinkCommandsFor, type RelinkPair } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/**
 * 🎯 Fájlonkénti visszaállítás — a felhő-mentésből (asset.remoteUrl: R2 vagy a
 * user saját tára, pl. Google Drive) és `.rp` csomagból is 1-1 KIVÁLASZTOTT fájl
 * hozható vissza, a teljes projekt-import nélkül. A relink a command-buson megy
 * (undo-zható), a letöltés fájlonként best-effort.
 */

function mb(size?: number): string {
  return size && size > 0 ? ` · ${Math.max(1, Math.round(size / 1024 / 1024))} MB` : '';
}

/** a visszaállítás-párok átvitele a JELENLEGI store-projektre (undo-safe) */
function applyPairs(pairs: RelinkPair[]): number {
  const state = useEditorStore.getState();
  if (!state.project || pairs.length === 0) {
    return 0;
  }
  let applied = 0;
  for (const cmd of relinkCommandsFor(state.project, pairs)) {
    if (state.dispatch(cmd, 'system')) {
      applied += 1;
    }
  }
  return applied;
}

export function CloudMediaSection({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [busyUri, setBusyUri] = useState<string | null>(null);
  const [rpBusy, setRpBusy] = useState(false);

  const backedUp = project.assets.filter(
    (a) => a.remoteUrl && (a.kind === 'video' || a.kind === 'image' || a.kind === 'audio'),
  );

  const restoreOne = (uri: string, name: string) => {
    if (busyUri) {
      return;
    }
    setBusyUri(uri);
    restoreSelectedMedia(project, [uri])
      .then(({ pairs, failed }) => {
        applyPairs(pairs);
        if (failed.length > 0) {
          Alert.alert(t('common.error'), t('panels.export.restoreFailed', { name }));
        } else {
          Alert.alert(t('panels.export.cloudFilesTitle'), t('panels.export.restoredOk', { name }));
        }
      })
      .finally(() => setBusyUri(null));
  };

  // 🎯 `.rp` csomagból (pl. Drive-ra mentettből) kiválasztott fájlok visszaállítása
  const restoreFromRp = async () => {
    if (rpBusy) {
      return;
    }
    setRpBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/zip', 'application/octet-stream', '*/*'],
      });
      if (picked.canceled || picked.assets.length === 0) {
        return;
      }
      const rpUri = picked.assets[0].uri;
      const entries = listRpMediaEntries(rpUri);
      if (entries.length === 0) {
        Alert.alert(t('panels.export.rpRestoreBtn'), t('panels.export.rpNoMedia'));
        return;
      }
      // tételenkénti kérdés (a relink-flow mintájára) — a kiválasztottak jönnek vissza
      const selected: string[] = [];
      for (const entry of entries) {
        const want = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('panels.export.rpRestoreBtn'),
            t('panels.export.rpRestoreAsk', { name: entry.fileName + mb(entry.size) }),
            [
              { text: t('lib.videdFile.skip'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('editor.versions.restore'), onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });
        if (want) {
          selected.push(entry.name);
        }
      }
      if (selected.length === 0) {
        return;
      }
      const restored = extractRpMediaSelected(rpUri, selected);
      // a jelenlegi projekt hivatkozásainak átkötése a visszaállított fájlokra
      const pairs: RelinkPair[] = [];
      for (const { uri, key } of extractMediaUriEntries(JSON.stringify(project))) {
        const next = restored.get(`${key.dir}/${key.name}`);
        if (next && next !== uri) {
          pairs.push({ oldUri: uri, newUri: next });
        }
      }
      applyPairs(pairs);
      Alert.alert(
        t('panels.export.rpRestoreBtn'),
        t('panels.export.rpRestoreDone', { count: restored.size }),
      );
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setRpBusy(false);
    }
  };

  return (
    <PanelSection title={t('panels.export.cloudFilesTitle')}>
      {backedUp.length === 0 ? (
        <Text style={{ color: palette.textDim, fontSize: 12 }}>
          {t('panels.export.cloudFilesEmpty')}
        </Text>
      ) : (
        backedUp.map((a) => (
          <View
            key={a.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}
          >
            <Ionicons name="cloud-done-outline" size={15} color={palette.accent} />
            <Text style={{ flex: 1, color: palette.text, fontSize: 13 }} numberOfLines={1}>
              {a.name ?? a.uri.split('/').pop()}
              {mb(a.size)}
            </Text>
            {busyUri === a.uri ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Pressable
                onPress={() => restoreOne(a.uri, a.name ?? '')}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Ionicons name="cloud-download-outline" size={18} color={palette.accent} />
              </Pressable>
            )}
          </View>
        ))
      )}
      <PrimaryButton
        icon="archive-outline"
        label={rpBusy ? t('common.processing') : t('panels.export.rpRestoreBtn')}
        onPress={() => {
          void restoreFromRp();
        }}
      />
    </PanelSection>
  );
}
