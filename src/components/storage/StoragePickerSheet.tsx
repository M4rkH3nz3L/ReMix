import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryRow } from '@/components/storage/StorageParts';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { type FileKind, type StorageEntry, breadcrumbs, fileKindOf, parentPath, sortEntries } from '@/lib/remixFiles';
import { RemixFilesError, deviceList, remixList } from '@/lib/remixFilesClient';

/**
 * 🗂️ Fájl-választó a Tárhelyemből (Eszközöm / ReMix Storage) — a projekten belüli
 * importhoz, ugyanúgy, mint a telefon fájlválasztója. Csak a megadott fajtájú
 * fájlok választhatók; a mappák navigálhatók. Több kijelölés → `onPick(entries)`.
 */
export function StoragePickerSheet({
  visible,
  kinds,
  onClose,
  onPick,
}: {
  visible: boolean;
  kinds: FileKind[];
  onClose: () => void;
  onPick: (entries: StorageEntry[]) => void;
}) {
  const { t } = useTranslation();
  const [location, setLocation] = useState<'device' | 'remix'>('device');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, StorageEntry>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = location === 'device' ? deviceList(path) : await remixList(path);
      setEntries(sortEntries(list.filter((e) => e.isFolder || kinds.includes(fileKindOf(e.name))), 'name'));
    } catch (err) {
      setEntries([]);
      setError(
        err instanceof RemixFilesError
          ? t(`storage.errors.${err.code}`, { defaultValue: err.message })
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setLoading(false);
    }
  }, [location, path, kinds, t]);

  useEffect(() => {
    if (visible) {
      void Promise.resolve().then(load);
    }
  }, [visible, load]);

  const switchTo = (loc: 'device' | 'remix') => {
    setLocation(loc);
    setPath('');
  };

  const toggle = (e: StorageEntry) =>
    setPicked((prev) => {
      const next = new Map(prev);
      const key = `${e.location}:${e.path}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, e);
      }
      return next;
    });

  const close = () => {
    setPicked(new Map());
    onClose();
  };

  const confirm = () => {
    const list = [...picked.values()];
    setPicked(new Map());
    onPick(list);
  };

  const crumbs = useMemo(() => breadcrumbs(path), [path]);
  const rootName = t(location === 'device' ? 'storage.locations.device' : 'storage.locations.remix');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={path ? () => setPath(parentPath(path)) : close} hitSlop={10}>
            <Ionicons name={path ? 'chevron-back' : 'close'} size={22} color={palette.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {crumbs.length ? crumbs[crumbs.length - 1].name : t('storage.pickerTitle')}
          </Text>
        </View>

        <View style={styles.tabs}>
          {(['device', 'remix'] as const).map((loc) => (
            <Pressable key={loc} onPress={() => switchTo(loc)} style={[styles.tab, location === loc && styles.tabOn]}>
              <Ionicons
                name={loc === 'device' ? 'phone-portrait-outline' : 'cloud-outline'}
                size={14}
                color={location === loc ? palette.text : palette.textDim}
              />
              <Text style={[styles.tabText, location === loc && styles.tabTextOn]}>
                {t(loc === 'device' ? 'storage.locations.device' : 'storage.locations.remix')}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.crumb} numberOfLines={1}>
          {[rootName, ...crumbs.map((c) => c.name)].join(' › ')}
        </Text>

        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <EntryRow
              entry={item}
              grid={false}
              selected={picked.has(`${item.location}:${item.path}`)}
              onPress={() => (item.isFolder ? setPath(item.path) : toggle(item))}
              onLongPress={() => (item.isFolder ? undefined : toggle(item))}
            />
          )}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={palette.accent} style={styles.empty} />
            ) : (
              <Text style={[styles.emptyText, styles.empty]}>{error ?? t('storage.pickerEmpty')}</Text>
            )
          }
        />

        <View style={styles.footer}>
          <PrimaryButton
            icon="add"
            label={t('storage.pickerAdd', { count: picked.size })}
            onPress={confirm}
            disabled={picked.size === 0}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: palette.surface,
  },
  tabOn: { backgroundColor: palette.accentSoft },
  tabText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: palette.text },
  crumb: { color: palette.textDim, fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  list: { padding: 12, paddingBottom: 24 },
  empty: { marginTop: 40 },
  emptyText: { color: palette.textDim, fontSize: 14, textAlign: 'center' },
  footer: { padding: 16 },
});
