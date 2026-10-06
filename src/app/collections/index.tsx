import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { createGenerationGuard } from '@/lib/asyncGuard';
import { createCollection, deleteCollection, listCollections, type PostCollection } from '@/lib/postCollections';

/**
 * 📁 Kollekciók — a felhasználó mappái/playlistjei (az élő `post_collections` fölött).
 * Új kollekció inline létrehozással; a sorra koppintva a kollekció-oldal nyílik.
 */
export default function CollectionsScreen() {
  const { t } = useTranslation();
  const [cols, setCols] = useState<PostCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const guardRef = useRef(createGenerationGuard());

  const load = useCallback(() => {
    const guard = guardRef.current;
    const token = guard.begin();
    const timer = setTimeout(() => {
      if (!guard.isCurrent(token)) {
        return;
      }
      setLoading(true);
      listCollections()
        .then((r) => {
          if (guard.isCurrent(token)) {
            setCols(r);
          }
        })
        .catch(() => {
          if (guard.isCurrent(token)) {
            setCols([]);
          }
        })
        .finally(() => {
          if (guard.isCurrent(token)) {
            setLoading(false);
          }
        });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => load(), [load]);

  const onCreate = () => {
    const n = name.trim();
    if (!n || busy) {
      return;
    }
    setBusy(true);
    createCollection(n)
      .then(() => {
        setName('');
        load();
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const onDelete = (c: PostCollection) => {
    deleteCollection(c.id)
      .then(() => setCols((prev) => prev.filter((x) => x.id !== c.id)))
      .catch(() => {});
  };

  const open = (c: PostCollection) =>
    router.push(`/collections/${c.id}?name=${encodeURIComponent(c.name)}`);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('collections.title')}</Text>
      </View>

      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t('collections.newPlaceholder')}
          placeholderTextColor={palette.textDim}
          returnKeyType="done"
          onSubmitEditing={onCreate}
          maxLength={80}
        />
        <Pressable onPress={onCreate} hitSlop={8} style={[styles.addBtn, !name.trim() && styles.addBtnOff]}>
          <Ionicons name="add" size={22} color={name.trim() ? '#fff' : palette.textDim} />
        </Pressable>
      </View>

      {loading && cols.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : cols.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="folder-outline" size={44} color={palette.border} />
          <Text style={styles.hint}>{t('collections.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={cols}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => open(item)}>
              <Ionicons name="folder" size={22} color={palette.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                {typeof item.itemCount === 'number' ? (
                  <Text style={styles.rowSub}>{t('collections.count', { n: item.itemCount })}</Text>
                ) : null}
              </View>
              <Pressable onPress={() => onDelete(item)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={palette.textDim} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: { padding: 4 },
  title: { flex: 1, color: palette.text, fontSize: 18, fontWeight: '800' },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  input: {
    flex: 1,
    color: palette.text,
    fontSize: 15,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnOff: { backgroundColor: palette.surfaceHigh },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  hint: { color: palette.textDim, fontSize: 14, textAlign: 'center' },
  list: { paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowTitle: { color: palette.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: palette.textDim, fontSize: 12, marginTop: 2 },
});
