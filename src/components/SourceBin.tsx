import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { assetDisplayState, assetStateBadge, canDownload } from '@/lib/assetState';
import { assetSyncState, syncStateBadge } from '@/lib/fileConflict';
import { makeId } from '@/lib/id';
import { downloadToCache } from '@/lib/media';
import { reachableMediaUrl } from '@/lib/mediaUrl';
import { projectKind } from '@/lib/projectUtils';
import { assetInUse, countSourceKinds, pickSourceAsset, supportedSourceKinds, type SourceKind } from '@/lib/projectSource';
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
 * 🗂️ A projekt FORRÁS-mappája (source bin) — elrendezés-mentes TARTALOM: a
 * `project.assets` böngészője + támogatott-fájl import (fajta-picker) + a NEM
 * használt forrás eltávolítása + a felhő-forrás letöltése helyi másolatként.
 * Minden a command-buson megy (ADD_ASSET / REMOVE_ASSET → undo).
 *
 * Ugyanazt a tartalmat jeleníti meg a modal [SourceSheet] (telefon) ÉS a
 * mindig-látható dokkolt forrás-panel (tablet/fekvő) — csak a keret más.
 * `compact`: keskeny dokk-panelhez (rejtett hint); `scroll`: saját ScrollView
 * (a dokk-panelhez; a sheet maga görget, ott `scroll=false`).
 */
export function SourceBin({
  onInsert,
  compact = false,
  scroll = false,
}: {
  onInsert?: (asset: Asset) => void;
  compact?: boolean;
  scroll?: boolean;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [filter, setFilter] = useState<SourceKind | 'all'>('all');
  if (!project) {
    return null;
  }
  const assets = project.assets;
  const kinds = supportedSourceKinds(projectKind(project));
  // 🗂️ típus-szűrő: „mind" + fajtánkénti darabszám; a kijelzett lista eszerint szűrve
  const counts = countSourceKinds(assets);
  const filterKinds = kinds.filter((k) => counts[k] > 0);
  const visible = filter === 'all' ? assets : assets.filter((a) => a.kind === filter);

  const importOne = (sk: SourceKind) => {
    pickSourceAsset(sk)
      .then((asset) => {
        if (asset) {
          useEditorStore.getState().dispatch({ type: 'ADD_ASSET', asset }, 'user');
        }
      })
      .catch(() => {});
  };

  // 🡇 külső (felhő) forrás letöltése HELYI másolatként a binbe (ADD_ASSET).
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

  const body = (
    <>
      {!compact ? <Text style={styles.hint}>{t('source.hint')}</Text> : null}
      <View style={styles.importRow}>
        {kinds.map((sk) => (
          <Pressable key={sk} style={styles.importBtn} onPress={() => importOne(sk)}>
            <Ionicons name="add" size={14} color={palette.accent} />
            <Text style={styles.importBtnText}>{t(`studio.kind.${sk}`)}</Text>
          </Pressable>
        ))}
      </View>

      {filterKinds.length > 1 ? (
        <View style={styles.filterRow}>
          <Pressable style={[styles.chip, filter === 'all' && styles.chipOn]} onPress={() => setFilter('all')}>
            <Text style={[styles.chipText, filter === 'all' && styles.chipTextOn]}>
              {t('source.filterAll')} · {assets.length}
            </Text>
          </Pressable>
          {filterKinds.map((k) => (
            <Pressable key={k} style={[styles.chip, filter === k && styles.chipOn]} onPress={() => setFilter(k)}>
              <Text style={[styles.chipText, filter === k && styles.chipTextOn]}>
                {t(`studio.kind.${k}`)} · {counts[k]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {assets.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={30} color={palette.border} />
          <Text style={styles.emptyText}>{t('source.empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visible.map((a) => {
            const used = assetInUse(project, a);
            const badge = assetStateBadge(assetDisplayState(a));
            const badgeColor =
              badge.tone === 'ok' ? palette.accent : badge.tone === 'warn' ? '#f5a623' : palette.textDim;
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
    </>
  );

  if (scroll) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    );
  }
  return <View style={styles.plain}>{body}</View>;
}

const styles = StyleSheet.create({
  scrollContent: { gap: 10, padding: 12 },
  plain: { gap: 10 },
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  chipTextOn: { color: palette.bg },
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
