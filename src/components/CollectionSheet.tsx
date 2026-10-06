import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { createGenerationGuard } from '@/lib/asyncGuard';
import {
  addToCollection,
  collectionIdsWithPost,
  createCollection,
  listCollections,
  removeFromCollection,
  type PostCollection,
} from '@/lib/postCollections';

/**
 * 📁 Kollekció-választó — egy posztot mentünk mappá(k)ba (az élő `post_collections`
 * fölött). A pipa a jelenlegi tagságot mutatja; koppintásra hozzáad/elvesz; alul
 * inline új kollekció. A `postId` null-ra zárva (a `onClose` ezt teszi).
 */
export function CollectionSheet({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [cols, setCols] = useState<PostCollection[]>([]);
  const [member, setMember] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const guardRef = useRef(createGenerationGuard());

  useEffect(() => {
    if (!postId) {
      return;
    }
    const guard = guardRef.current;
    const token = guard.begin();
    const timer = setTimeout(() => {
      if (!guard.isCurrent(token)) {
        return;
      }
      setLoading(true);
      Promise.all([listCollections(), collectionIdsWithPost(postId)])
        .then(([list, ids]) => {
          if (guard.isCurrent(token)) {
            setCols(list);
            setMember(new Set(ids));
          }
        })
        .catch(() => {
          if (guard.isCurrent(token)) {
            setCols([]);
            setMember(new Set());
          }
        })
        .finally(() => {
          if (guard.isCurrent(token)) {
            setLoading(false);
          }
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [postId]);

  const toggle = (c: PostCollection) => {
    if (!postId) {
      return;
    }
    const inIt = member.has(c.id);
    // optimista: azonnal frissítjük a pipát, hibánál visszaállítjuk
    setMember((prev) => {
      const next = new Set(prev);
      if (inIt) {
        next.delete(c.id);
      } else {
        next.add(c.id);
      }
      return next;
    });
    const op = inIt ? removeFromCollection(c.id, postId) : addToCollection(c.id, postId);
    op.catch(() => {
      setMember((prev) => {
        const next = new Set(prev);
        if (inIt) {
          next.add(c.id);
        } else {
          next.delete(c.id);
        }
        return next;
      });
    });
  };

  const onCreate = () => {
    const n = name.trim();
    if (!n || busy || !postId) {
      return;
    }
    setBusy(true);
    createCollection(n)
      .then((id) => {
        setName('');
        setCols((prev) => [{ id, name: n, createdAt: '' }, ...prev]);
        if (id) {
          setMember((prev) => new Set(prev).add(id));
          return addToCollection(id, postId);
        }
        return undefined;
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <Modal visible={postId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('collections.addTo')}</Text>

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

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : cols.length === 0 ? (
          <Text style={styles.empty}>{t('collections.empty')}</Text>
        ) : (
          <FlatList
            data={cols}
            keyExtractor={(c) => c.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = member.has(item.id);
              return (
                <Pressable style={styles.row} onPress={() => toggle(item)}>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? palette.accent : palette.textDim}
                  />
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            }}
          />
        )}

        <Pressable style={styles.doneBtn} onPress={onClose}>
          <Text style={styles.doneText}>{t('collections.done')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '70%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 10 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
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
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  addBtnOff: { backgroundColor: palette.surfaceHigh },
  center: { paddingVertical: 32, alignItems: 'center' },
  empty: { color: palette.textDim, textAlign: 'center', paddingVertical: 24 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowTitle: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '600' },
  doneBtn: { marginTop: 8, backgroundColor: palette.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
