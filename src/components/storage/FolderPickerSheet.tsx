import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryRow } from '@/components/storage/StorageParts';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { type StorageEntry, breadcrumbs, parentPath, sortEntries } from '@/lib/remixFiles';
import { deviceList, remixList } from '@/lib/remixFilesClient';

/**
 * 📂 Cél-mappa választó az áthelyezéshez (ugyanazon a helyen belül). A mozgatott
 * elemek maguk (és mappák esetén a saját al-mappáik) nem választhatók célnak.
 */
export function FolderPickerSheet({
  visible,
  location,
  moving,
  onClose,
  onPick,
}: {
  visible: boolean;
  location: 'device' | 'remix';
  /** a mozgatott elemek útjai */
  moving: string[];
  onClose: () => void;
  onPick: (dir: string) => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [folders, setFolders] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = location === 'device' ? deviceList(path) : await remixList(path);
      setFolders(sortEntries(list.filter((e) => e.isFolder), 'name'));
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [location, path]);

  useEffect(() => {
    if (visible) {
      void Promise.resolve().then(load);
    }
  }, [visible, load]);

  /** önmagába / saját al-mappájába nem mozgatható */
  const blocked = (p: string) => moving.some((m) => p === m || p.startsWith(`${m}/`));
  // a jelenlegi szülő-mappa nem cél (oda „mozgatni" no-op)
  const sameParent = moving.length > 0 && moving.every((m) => parentPath(m) === path);
  const crumbs = breadcrumbs(path);
  const rootName = t(location === 'device' ? 'storage.locations.device' : 'storage.locations.remix');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={path ? () => setPath(parentPath(path)) : onClose} hitSlop={10}>
            <Ionicons name={path ? 'chevron-back' : 'close'} size={22} color={palette.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {t('storage.moveTitle')}
          </Text>
        </View>
        <Text style={styles.crumb} numberOfLines={1}>
          {[rootName, ...crumbs.map((c) => c.name)].join(' › ')}
        </Text>
        <FlatList
          data={folders}
          keyExtractor={(e) => e.path}
          contentContainerStyle={styles.list}
          renderItem={({ item }) =>
            blocked(item.path) ? null : (
              <EntryRow
                entry={item}
                grid={false}
                selected={false}
                onPress={() => setPath(item.path)}
                onLongPress={() => setPath(item.path)}
              />
            )
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={palette.accent} style={styles.empty} />
            ) : (
              <Text style={[styles.emptyText, styles.empty]}>{t('storage.noSubfolders')}</Text>
            )
          }
        />
        <View style={styles.footer}>
          <PrimaryButton
            icon="folder-open-outline"
            label={t('storage.moveHere', { folder: crumbs.length ? crumbs[crumbs.length - 1].name : rootName })}
            onPress={() => onPick(path)}
            disabled={sameParent || blocked(path)}
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
  crumb: { color: palette.textDim, fontSize: 12, paddingHorizontal: 16 },
  list: { padding: 12, paddingBottom: 24 },
  empty: { marginTop: 40 },
  emptyText: { color: palette.textDim, fontSize: 14, textAlign: 'center' },
  footer: { padding: 16 },
});
