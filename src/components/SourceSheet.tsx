import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { assetDisplayState, assetStateBadge, canDownload } from '@/lib/assetState';
import { assetSyncState, syncStateBadge } from '@/lib/fileConflict';
import { makeId } from '@/lib/id';
import { downloadToCache } from '@/lib/media';
import { reachableMediaUrl } from '@/lib/mediaUrl';
import { projectKind } from '@/lib/projectUtils';
import { assetInUse, pickSourceAsset, supportedSourceKinds, type SourceKind } from '@/lib/projectSource';
import { formatBytes } from '@/lib/storageQuota';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Asset } from '@/types/project';

const KIND_ICON: Record<SourceKind, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  image: 'image',
  audio: 'musical-notes',
};

/**
 * 🗂️ A projekt FORRÁS-mappája (source bin) — minden stúdióban UGYANÚGY. A
 * `project.assets` böngészése + támogatott fájlok importja (a fajta szerinti
 * pickerrel) + a NEM használt forrás eltávolítása. Minden a command-buson megy
 * (ADD_ASSET / REMOVE_ASSET → undo). Az `onInsert` opcionális: ha a szerkesztő
 * tudja fogadni, a forrás egy koppintással a szerkesztő-felületre kerül.
 */
export function SourceSheet({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert?: (asset: Asset) => void;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [downloading, setDownloading] = useState<string | null>(null);
  if (!project) {
    return null;
  }
  const assets = project.assets;
  const kinds = supportedSourceKinds(projectKind(project));

  const importOne = (sk: SourceKind) => {
    pickSourceAsset(sk)
      .then((asset) => {
        if (asset) {
          useEditorStore.getState().dispatch({ type: 'ADD_ASSET', asset }, 'user');
        }
      })
      .catch(() => {});
  };

  // 🡇 §2.2: külső (felhő) forrás letöltése HELYI másolatként a binbe (ADD_ASSET).
  // A klipek nyers uri-t hivatkoznak (uri→assetId refaktor hátra), ezért nem az eredetit
  // írjuk át, hanem egy használható helyi másolatot adunk hozzá; az eltávolítás = remove.
  const downloadAsset = (a: Asset) => {
    if (downloading) {
      return;
    }
    const url = reachableMediaUrl(a.uri) ?? a.uri;
    setDownloading(a.id);
    downloadToCache(url, a.name)
      .then((local) => {
        if (local) {
          useEditorStore.getState().dispatch(
            { type: 'ADD_ASSET', asset: { id: makeId('ast'), kind: a.kind, uri: local, provider: 'local', name: a.name } },
            'user'
          );
        }
      })
      .catch(() => {})
      .finally(() => setDownloading(null));
  };

  const meta = (a: Asset): string => {
    const parts = [t(`studio.kind.${a.kind}`)];
    if (a.duration) {
      parts.push(formatTime(a.duration));
    }
    if (a.size) {
      parts.push(formatBytes(a.size));
    }
    return parts.join(' · ');
  };

  return (
    <StudioSheet title={t('source.title')} icon="folder-open" onClose={onClose}>
      <Text style={styles.hint}>{t('source.hint')}</Text>
      <View style={styles.importRow}>
        {kinds.map((sk) => (
          <Pressable key={sk} style={styles.importBtn} onPress={() => importOne(sk)}>
            <Ionicons name="add" size={14} color={palette.accent} />
            <Text style={styles.importBtnText}>{t(`studio.kind.${sk}`)}</Text>
          </Pressable>
        ))}
      </View>

      {assets.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={30} color={palette.border} />
          <Text style={styles.emptyText}>{t('source.empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {assets.map((a) => {
            const used = assetInUse(project, a);
            // 🗄️ §8.2: a tárolás-állapot jelzője (☁️ external / ✓ cached/imported / ⚠️ stale)
            const badge = assetStateBadge(assetDisplayState(a));
            const badgeColor =
              badge.tone === 'ok' ? palette.accent : badge.tone === 'warn' ? '#f5a623' : palette.textDim;
            // 🔀 §8.6: backup-dimenzió — a helyi (eszközön készült) forrás fel van-e
            // töltve a felhőbe? A `local-only` = még NINCS mentve → figyelmeztetés.
            const notBackedUp = assetSyncState(a) === 'local-only';
            const syncBadge = notBackedUp ? syncStateBadge('local-only') : null;
            return (
              <View key={a.id} style={styles.item}>
                <Ionicons name={KIND_ICON[a.kind]} size={16} color={palette.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {a.name ?? a.kind}
                  </Text>
                  <View style={styles.metaRow}>
                    <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={11} color={badgeColor} />
                    <Text style={[styles.itemMeta, { color: badgeColor }]}>{t(badge.labelKey)}</Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      · {meta(a)}
                      {used ? ` · ${t('source.inUse')}` : ''}
                    </Text>
                    {syncBadge ? (
                      <>
                        <Ionicons name={syncBadge.icon as keyof typeof Ionicons.glyphMap} size={11} color="#f5a623" />
                        <Text style={[styles.itemMeta, { color: '#f5a623' }]}>{t(syncBadge.labelKey)}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
                {canDownload(assetDisplayState(a)) ? (
                  <Pressable
                    onPress={() => downloadAsset(a)}
                    disabled={!!downloading}
                    hitSlop={8}
                    style={styles.itemAction}
                    accessibilityRole="button"
                    accessibilityLabel={t('source.download')}
                  >
                    {downloading === a.id ? (
                      <ActivityIndicator size="small" color={palette.accent} />
                    ) : (
                      <Ionicons name="cloud-download-outline" size={20} color={palette.accent} />
                    )}
                  </Pressable>
                ) : null}
                {onInsert ? (
                  <Pressable
                    onPress={() => onInsert(a)}
                    hitSlop={8}
                    style={styles.itemAction}
                    accessibilityRole="button"
                    accessibilityLabel={t('source.insert')}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={palette.accent} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() =>
                    useEditorStore.getState().dispatch({ type: 'REMOVE_ASSET', assetId: a.id }, 'user')
                  }
                  disabled={used}
                  hitSlop={8}
                  style={styles.itemAction}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                >
                  <Ionicons name="trash-outline" size={18} color={used ? palette.border : palette.textDim} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 16 },
  importRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.surfaceHigh,
  },
  importBtnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 26 },
  emptyText: { color: palette.textDim, fontSize: 12 },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  itemName: { color: palette.text, fontSize: 14, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  itemMeta: { color: palette.textDim, fontSize: 11 },
  itemAction: { padding: 2 },
});
