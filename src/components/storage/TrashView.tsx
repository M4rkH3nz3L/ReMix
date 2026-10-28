import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EntryIcon } from '@/components/storage/StorageParts';
import { palette } from '@/constants/editor';
import {
  RemixFilesError,
  type TrashItem,
  remixTrashList,
  remixTrashPurge,
  remixTrashRestore,
} from '@/lib/remixFilesClient';
import { formatBytes } from '@/lib/storageQuota';

/**
 * 🗑️ A ReMix Storage Lomtára: a törölt fájlok/mappák 30 napig visszaállíthatók az
 * eredeti helyükre (ütközésnél `név (1)`), vagy véglegesen törölhetők. A Lomtár a
 * tárhely-kvótába számít — a végleges törlés szabadít fel helyet.
 */
export function TrashView({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** a lekérés pillanata (a „még N nap” ehhez képest — render közben nincs Date.now) */
  const [loadedAt, setLoadedAt] = useState(0);

  const errText = useCallback(
    (err: unknown) =>
      err instanceof RemixFilesError
        ? t(`storage.errors.${err.code}`, { defaultValue: err.message })
        : err instanceof Error
          ? err.message
          : String(err),
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await remixTrashList();
      setItems(res.items);
      setRetention(res.retentionDays);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, [errText]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      Alert.alert(t('storage.trash.title'), errText(err));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const restore = (it: TrashItem) => void run(() => remixTrashRestore([it.id]));

  const purge = (ids: string[] | 'all') =>
    Alert.alert(
      t(ids === 'all' ? 'storage.trash.emptyTitle' : 'storage.trash.purgeTitle'),
      t('storage.trash.purgeBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => remixTrashPurge(ids)) },
      ]
    );

  const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - loadedAt) / 86400000));
  const total = items.reduce((a, i) => a + i.bytes, 0);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      refreshing={loading}
      onRefresh={() => void load()}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.head}>
          <Text style={styles.hint}>{t('storage.trash.hint', { days: retention })}</Text>
          {items.length ? (
            <View style={styles.headRow}>
              <Text style={styles.meta}>
                {t('storage.trash.summary', { count: items.length, size: formatBytes(total) })}
              </Text>
              <Pressable onPress={() => purge('all')} disabled={busy} hitSlop={8}>
                <Text style={[styles.link, { color: palette.danger }]}>{t('storage.trash.empty')}</Text>
              </Pressable>
            </View>
          ) : null}
          {busy ? <ActivityIndicator color={palette.accent} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.icon}>
            <EntryIcon entry={{ location: 'remix', path: item.path, name: item.name, isFolder: item.isFolder }} />
          </View>
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {item.path} · {formatBytes(item.bytes)} · {t('storage.trash.daysLeft', { count: daysLeft(item.expiresAt) })}
            </Text>
          </View>
          <Pressable onPress={() => restore(item)} disabled={busy} hitSlop={8} style={styles.btn}>
            <Ionicons name="arrow-undo-outline" size={20} color={palette.accent} />
          </Pressable>
          <Pressable onPress={() => purge([item.id])} disabled={busy} hitSlop={8} style={styles.btn}>
            <Ionicons name="trash-outline" size={20} color={palette.danger} />
          </Pressable>
        </View>
      )}
      ListEmptyComponent={
        loading ? null : (
          <View style={styles.empty}>
            <Ionicons name={error ? 'cloud-offline-outline' : 'trash-bin-outline'} size={40} color={palette.textDim} />
            <Text style={styles.emptyText}>{error ?? t('storage.trash.isEmpty')}</Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, paddingBottom: 48 },
  head: { gap: 8, paddingHorizontal: 4, marginBottom: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { color: palette.textDim, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  icon: { width: 38, alignItems: 'center' },
  body: { flex: 1, gap: 2 },
  name: { color: palette.text, fontSize: 15, fontWeight: '600' },
  meta: { color: palette.textDim, fontSize: 12 },
  btn: { padding: 6 },
  link: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyText: { color: palette.textDim, fontSize: 14, textAlign: 'center' },
});
