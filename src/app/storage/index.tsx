import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActionSheet,
  EntryRow,
  LocationCard,
  type SheetAction,
  TransferList,
} from '@/components/storage/StorageParts';
import { RenameModal } from '@/components/studio/RenameModal';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { useStorageBrowser } from '@/hooks/useStorageBrowser';
import { goBackOrHome } from '@/lib/nav';
import { type KindFilter, type StorageEntry, breadcrumbs } from '@/lib/remixFiles';
import { formatBytes } from '@/lib/storageQuota';

const KINDS: KindFilter[] = ['all', 'video', 'image', 'audio', 'project', 'document'];

/**
 * 🗂️ Tárhelyem — egy helyen az összes tárhely (devs/tasks/Storage/06-my-storage.md).
 * Áttekintő: a helyek kártyái (Eszközöm, ReMix Storage + a roadmap külső helyei);
 * egy helyre lépve mappás böngésző (keresés, típus-szűrő, rendezés, rács/lista,
 * több-kijelölés), műveleti lap és átviteli sor. A logika a `useStorageBrowser`-ben.
 */
export default function StorageScreen() {
  const s = useStorageBrowser();
  const { t } = s;
  const [action, setAction] = useState<StorageEntry | null>(null);
  const selecting = s.selected.size > 0;

  const soon = () =>
    Alert.alert(t('storage.soonTitle'), t('storage.soonBody'), [
      { text: t('common.close'), style: 'cancel' },
      { text: t('storage.openProfile'), onPress: () => router.push('/profile') },
    ]);

  const onEntryPress = (e: StorageEntry) => {
    if (selecting) {
      s.toggleSelect(e.path);
    } else if (e.isFolder) {
      s.go(e.path);
    } else {
      setAction(e);
    }
  };

  const actionsFor = (e: StorageEntry): SheetAction[] => {
    const list: SheetAction[] = [];
    if (e.location === 'device') {
      list.push({ key: 'up', icon: 'cloud-upload-outline', label: t('storage.copyToRemix'), onPress: () => s.copyToRemix([e]) });
      list.push({ key: 'share', icon: 'share-outline', label: t('common.share'), onPress: () => void s.share(e) });
    } else {
      list.push({
        key: 'down',
        icon: 'cloud-download-outline',
        label: t('storage.downloadToDevice'),
        onPress: () => s.downloadToDevice([e]),
      });
    }
    list.push({ key: 'select', icon: 'checkmark-circle-outline', label: t('storage.select'), onPress: () => s.toggleSelect(e.path) });
    list.push({ key: 'rename', icon: 'create-outline', label: t('common.rename'), onPress: () => s.startRename(e) });
    list.push({ key: 'delete', icon: 'trash-outline', label: t('common.delete'), destructive: true, onPress: () => s.confirmDelete([e.path]) });
    return list;
  };

  const header = (title: string, onBack: () => void) => (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );

  // ── áttekintő: a helyek ──
  if (!s.location) {
    const u = s.usage;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        {header(t('storage.title'), () => goBackOrHome())}
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subtitle}>{t('storage.subtitle')}</Text>
          <LocationCard
            icon="cloud-outline"
            title={t('storage.locations.remix')}
            subtitle={t('storage.locations.remixSub')}
            status={u ? t('storage.status.connected') : t('storage.status.signIn')}
            statusTone={u ? 'ok' : 'warn'}
            used={u?.usedBytes}
            quota={u?.quotaBytes}
            onPress={() => s.open('remix')}
          />
          <LocationCard
            icon="phone-portrait-outline"
            title={t('storage.locations.device')}
            subtitle={t('storage.locations.deviceSub', {
              used: formatBytes(s.device.used),
              free: formatBytes(s.device.free),
            })}
            status={t('storage.status.available')}
            onPress={() => s.open('device')}
          />
          <Text style={styles.sectionLabel}>{t('storage.external')}</Text>
          <LocationCard
            icon="logo-google"
            title="Google Drive"
            subtitle={t('storage.locations.externalSub')}
            status={t('storage.status.soon')}
            statusTone="dim"
            disabled
            onPress={soon}
          />
          <LocationCard
            icon="logo-dropbox"
            title="Dropbox"
            subtitle={t('storage.locations.externalSub')}
            status={t('storage.status.soon')}
            statusTone="dim"
            disabled
            onPress={soon}
          />
          <LocationCard
            icon="server-outline"
            title={t('storage.locations.nas')}
            subtitle={t('storage.locations.nasSub')}
            status={t('storage.status.soon')}
            statusTone="dim"
            disabled
            onPress={soon}
          />
          <TransferList transfers={s.transfers} onRetry={s.retry} onClear={s.clearFinished} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── böngésző ──
  const isDevice = s.location === 'device';
  const rootName = t(isDevice ? 'storage.locations.device' : 'storage.locations.remix');
  const crumbs = breadcrumbs(s.path);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {header(crumbs.length ? crumbs[crumbs.length - 1].name : rootName, s.up)}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
        <Pressable onPress={() => s.go('')}>
          <Text style={[styles.crumb, !crumbs.length && styles.crumbActive]}>{rootName}</Text>
        </Pressable>
        {crumbs.map((c, i) => (
          <View key={c.path} style={styles.crumbItem}>
            <Ionicons name="chevron-forward" size={12} color={palette.textDim} />
            <Pressable onPress={() => s.go(c.path)}>
              <Text style={[styles.crumb, i === crumbs.length - 1 && styles.crumbActive]}>{c.name}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      {/* HOL vannak ezek a fájlok — egy törlés/átnevezés itt valódi változás */}
      <View style={styles.whereBadge}>
        <Ionicons name={isDevice ? 'phone-portrait-outline' : 'cloud-outline'} size={14} color={palette.textDim} />
        <Text style={styles.whereText}>{t(isDevice ? 'storage.whereDevice' : 'storage.whereRemix')}</Text>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={palette.textDim} />
          <TextInput
            value={s.query}
            onChangeText={s.setQuery}
            placeholder={t('storage.search')}
            placeholderTextColor={palette.textDim}
            style={styles.searchInput}
          />
        </View>
        <Pressable onPress={s.cycleSort} onLongPress={() => s.setSortDesc((d) => !d)} hitSlop={6} style={styles.toolBtn}>
          <Ionicons name={s.sortDesc ? 'arrow-down' : 'arrow-up'} size={14} color={palette.text} />
          <Text style={styles.toolText}>{t(`storage.sort.${s.sortKey}`)}</Text>
        </Pressable>
        <Pressable onPress={() => s.setGrid((g) => !g)} hitSlop={6} style={styles.toolBtn}>
          <Ionicons name={s.grid ? 'list' : 'grid-outline'} size={16} color={palette.text} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k} label={t(`storage.kinds.${k}`)} active={s.kind === k} onPress={() => s.setKind(k)} />
        ))}
      </ScrollView>

      {selecting ? (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText}>{t('storage.selected', { count: s.selected.size })}</Text>
          {isDevice ? (
            <Pressable onPress={() => s.copyToRemix(s.selectedEntries)} hitSlop={6}>
              <Ionicons name="cloud-upload-outline" size={22} color={palette.text} />
            </Pressable>
          ) : (
            <Pressable onPress={() => s.downloadToDevice(s.selectedEntries)} hitSlop={6}>
              <Ionicons name="cloud-download-outline" size={22} color={palette.text} />
            </Pressable>
          )}
          <Pressable onPress={() => s.confirmDelete([...s.selected])} hitSlop={6}>
            <Ionicons name="trash-outline" size={22} color={palette.danger} />
          </Pressable>
          <Pressable onPress={s.clearSelection} hitSlop={6}>
            <Ionicons name="close" size={22} color={palette.textDim} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable onPress={s.startMkdir} style={styles.actionBtn}>
            <Ionicons name="folder-open-outline" size={16} color={palette.text} />
            <Text style={styles.toolText}>{t('storage.newFolder')}</Text>
          </Pressable>
          <Pressable onPress={() => void s.addFiles()} style={styles.actionBtn}>
            <Ionicons name={isDevice ? 'download-outline' : 'cloud-upload-outline'} size={16} color={palette.text} />
            <Text style={styles.toolText}>{t(isDevice ? 'storage.importFiles' : 'storage.uploadFiles')}</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        key={s.grid ? 'grid' : 'list'}
        data={s.visible}
        numColumns={s.grid ? 3 : 1}
        keyExtractor={(e) => e.path}
        refreshing={s.loading}
        onRefresh={() => void s.reload()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            grid={s.grid}
            selected={s.selected.has(item.path)}
            onPress={() => onEntryPress(item)}
            onLongPress={() => s.toggleSelect(item.path)}
          />
        )}
        ListEmptyComponent={
          s.loading ? (
            <ActivityIndicator color={palette.accent} style={styles.empty} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name={s.error ? 'cloud-offline-outline' : 'folder-open-outline'} size={40} color={palette.textDim} />
              <Text style={styles.emptyText}>
                {s.error ?? t(s.query || s.kind !== 'all' ? 'storage.noMatch' : 'storage.empty')}
              </Text>
              {s.error ? (
                <Pressable onPress={() => void s.reload()}>
                  <Text style={styles.link}>{t('common.retry')}</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={<TransferList transfers={s.transfers} onRetry={s.retry} onClear={s.clearFinished} />}
      />

      <ActionSheet
        entry={action}
        hint={t(isDevice ? 'storage.onDevice' : 'storage.inRemix')}
        actions={action ? actionsFor(action) : []}
        onClose={() => setAction(null)}
      />
      <RenameModal
        visible={s.dialog !== null}
        title={t(s.dialog?.mode === 'mkdir' ? 'storage.newFolder' : 'common.rename')}
        placeholder={t('storage.namePlaceholder')}
        value={s.dialog?.value ?? ''}
        onChangeValue={(v) => s.setDialog((d) => (d ? { ...d, value: v } : d))}
        onSave={() => void s.submitDialog()}
        onCancel={() => s.setDialog(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 },
  content: { padding: 16, gap: 12 },
  subtitle: { color: palette.textDim, fontSize: 14, lineHeight: 20 },
  sectionLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 8 },
  crumbs: { paddingHorizontal: 16, alignItems: 'center', gap: 4 },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumb: { color: palette.textDim, fontSize: 13, fontWeight: '600' },
  crumbActive: { color: palette.text },
  whereBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 8 },
  whereText: { color: palette.textDim, fontSize: 12, flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  searchInput: { flex: 1, color: palette.text, paddingVertical: 8, fontSize: 14 },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: palette.surface,
  },
  toolText: { color: palette.text, fontSize: 13, fontWeight: '600' },
  chips: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  actionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: palette.accentSoft,
  },
  selectionText: { color: palette.text, fontSize: 14, fontWeight: '700', flex: 1 },
  list: { padding: 12, paddingBottom: 48, gap: 2 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyText: { color: palette.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  link: { color: palette.accent, fontSize: 14, fontWeight: '700' },
});
