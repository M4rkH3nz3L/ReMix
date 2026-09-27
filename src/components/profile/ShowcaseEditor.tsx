import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type ComponentProps, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  type ShowcaseItem,
  type ShowcaseKind,
  SHOWCASE_KINDS,
  listShowcase,
  replaceAllShowcase,
} from '@/lib/creatorProfile';
import { reachableMediaUrl } from '@/lib/mediaUrl';
import { pickProfileImageLocal, uploadProfileImage } from '@/lib/profile';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
const ico = (name: string) => name as IoniconName;

const kindIcon = (kind: ShowcaseKind) =>
  ico(SHOWCASE_KINDS.find((k) => k.id === kind)?.icon ?? 'ellipse');

/**
 * 🖼️ Showcase szerkesztő — a user „portfóliója": kiemelt videók/projektek/képek,
 * kedvenc zene/film/játék, egyedi linkkártyák. Egy közös, sorrendezhető lista;
 * elemenként típus + cím + alcím + opcionális URL + borító (kép-feltöltés).
 * Önálló betöltés/mentés (a teljes lista lecserélése).
 */
export function ShowcaseEditor({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [thumbBusy, setThumbBusy] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listShowcase(userId)
      .then((rows) => {
        if (alive) {
          setItems(rows);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const patch = (i: number, part: Partial<ShowcaseItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...part } : it)));
  const remove = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) {
        return prev;
      }
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addKind = (kind: ShowcaseKind) => {
    setPicking(false);
    setItems((prev) => [
      ...prev,
      { id: `new-${prev.length}-${kind}`, kind, refId: '', title: '', subtitle: '', thumbUrl: '', url: '', sortOrder: prev.length },
    ]);
  };

  const pickThumb = async (i: number) => {
    if (thumbBusy !== null) {
      return;
    }
    try {
      const local = await pickProfileImageLocal();
      if (!local) {
        return;
      }
      setThumbBusy(i);
      const url = await uploadProfileImage(local);
      patch(i, { thumbUrl: url });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setThumbBusy(null);
    }
  };

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await replaceAllShowcase(items);
      setItems(await listShowcase(userId));
      Alert.alert(t('profile.savedTitle'), t('showcase.saved'));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {items.length === 0 ? <Text style={styles.empty}>{t('showcase.empty')}</Text> : null}

      {items.map((item, i) => {
        const thumb = reachableMediaUrl(item.thumbUrl);
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowHead}>
              <Ionicons name={kindIcon(item.kind)} size={15} color={palette.accent} />
              <Text style={styles.kindLabel}>{t(`showcase.kinds.${item.kind}`)}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={styles.iconBtn}>
                <Ionicons name="chevron-up" size={18} color={i === 0 ? palette.border : palette.textDim} />
              </Pressable>
              <Pressable
                onPress={() => move(i, 1)}
                disabled={i === items.length - 1}
                hitSlop={6}
                style={styles.iconBtn}
              >
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={i === items.length - 1 ? palette.border : palette.textDim}
                />
              </Pressable>
              <Pressable onPress={() => remove(i)} hitSlop={6} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={17} color={palette.danger} />
              </Pressable>
            </View>

            <View style={styles.rowBody}>
              <Pressable onPress={() => void pickThumb(i)} style={styles.thumb}>
                {thumbBusy === i ? (
                  <ActivityIndicator color={palette.accent} />
                ) : thumb ? (
                  <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Ionicons name="camera" size={18} color={palette.textDim} />
                )}
              </Pressable>
              <View style={{ flex: 1, gap: 6 }}>
                <TextInput
                  value={item.title}
                  onChangeText={(v) => patch(i, { title: v })}
                  placeholder={t('showcase.titlePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={styles.input}
                />
                <TextInput
                  value={item.subtitle}
                  onChangeText={(v) => patch(i, { subtitle: v })}
                  placeholder={t('showcase.subtitlePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={styles.input}
                />
              </View>
            </View>

            <TextInput
              value={item.url}
              onChangeText={(v) => patch(i, { url: v })}
              placeholder={t('showcase.urlPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
        );
      })}

      <Pressable onPress={() => setPicking(true)} style={styles.addBtn} accessibilityRole="button">
        <Ionicons name="add-circle-outline" size={18} color={palette.accent} />
        <Text style={styles.addText}>{t('showcase.addItem')}</Text>
      </Pressable>

      <PrimaryButton icon="checkmark" label={t('common.save')} disabled={saving} onPress={() => void save()} />

      {/* típus-választó */}
      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPicking(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('showcase.pickKind')}</Text>
            <View style={styles.grid}>
              {SHOWCASE_KINDS.map((k) => (
                <Pressable key={k.id} style={styles.gridItem} onPress={() => addKind(k.id)}>
                  <View style={styles.gridIcon}>
                    <Ionicons name={ico(k.icon)} size={22} color={palette.text} />
                  </View>
                  <Text style={styles.gridLabel} numberOfLines={1}>
                    {t(`showcase.kinds.${k.id}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 20, alignItems: 'center' },
  empty: { color: palette.textDim, fontSize: 13, textAlign: 'center', paddingVertical: 6 },
  row: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    gap: 8,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindLabel: { color: palette.text, fontSize: 13, fontWeight: '700' },
  iconBtn: { padding: 4 },
  rowBody: { flexDirection: 'row', gap: 10 },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 11,
  },
  addText: { color: palette.accent, fontSize: 14, fontWeight: '700' },
  sheetBackdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 12,
  },
  sheetTitle: { color: palette.text, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { width: '22%', alignItems: 'center', gap: 5, paddingVertical: 6 },
  gridIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: { color: palette.textDim, fontSize: 11, textAlign: 'center' },
});
