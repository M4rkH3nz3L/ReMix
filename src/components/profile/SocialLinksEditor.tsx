import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  type SocialLink,
  SOCIAL_PLATFORMS,
  listSocialLinks,
  replaceSocialLinks,
  socialPlatform,
  socialUrl,
} from '@/lib/creatorProfile';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
const ico = (name: string) => name as IoniconName;

/** A platformoknak, amiknek nincs `toUrl`-je (custom/website), teljes URL-t kérünk. */
const isFreeform = (platform: string) => !socialPlatform(platform).toUrl;

/**
 * 🔗 Social linkek szerkesztő — önálló (saját betöltés/mentés). Platform-választó
 * + platformonként @username (amiből URL generálódik) vagy custom URL; sorrend
 * (fel/le), publikus kapcsoló, törlés. Mentés: a teljes lista lecserélése.
 */
export function SocialLinksEditor({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let alive = true;
    listSocialLinks(userId)
      .then((rows) => {
        if (alive) {
          setLinks(rows);
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

  const patch = (i: number, part: Partial<SocialLink>) =>
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...part } : l)));
  const remove = (i: number) => setLinks((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setLinks((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) {
        return prev;
      }
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addPlatform = (platform: string) => {
    setPicking(false);
    setLinks((prev) => [
      ...prev,
      { id: `new-${prev.length}-${platform}`, platform, username: '', url: '', displayName: '', isPublic: true, sortOrder: prev.length },
    ]);
  };

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await replaceSocialLinks(links);
      // az ideiglenes id-k helyett a friss, mentett sorokat töltjük vissza
      setLinks(await listSocialLinks(userId));
      Alert.alert(t('profile.savedTitle'), t('socialLinks.saved'));
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
      {links.length === 0 ? <Text style={styles.empty}>{t('socialLinks.empty')}</Text> : null}

      {links.map((link, i) => {
        const p = socialPlatform(link.platform);
        const freeform = isFreeform(link.platform);
        return (
          <View key={link.id} style={styles.row}>
            <View style={styles.rowHead}>
              <View style={styles.pIcon}>
                <Ionicons name={ico(p.icon)} size={16} color={palette.text} />
              </View>
              <Text style={styles.pLabel}>{p.label}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={styles.iconBtn}>
                <Ionicons name="chevron-up" size={18} color={i === 0 ? palette.border : palette.textDim} />
              </Pressable>
              <Pressable
                onPress={() => move(i, 1)}
                disabled={i === links.length - 1}
                hitSlop={6}
                style={styles.iconBtn}
              >
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={i === links.length - 1 ? palette.border : palette.textDim}
                />
              </Pressable>
              <Pressable onPress={() => remove(i)} hitSlop={6} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={17} color={palette.danger} />
              </Pressable>
            </View>

            {freeform ? (
              <>
                <TextInput
                  value={link.displayName}
                  onChangeText={(v) => patch(i, { displayName: v })}
                  placeholder={t('socialLinks.titlePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={styles.input}
                />
                <TextInput
                  value={link.url}
                  onChangeText={(v) => patch(i, { url: v })}
                  placeholder={t('socialLinks.urlPlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </>
            ) : (
              <>
                <TextInput
                  value={link.username}
                  onChangeText={(v) => patch(i, { username: v })}
                  placeholder={t('socialLinks.usernamePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {link.username.trim() ? (
                  <Text style={styles.urlPreview} numberOfLines={1}>
                    {socialUrl(link)}
                  </Text>
                ) : null}
              </>
            )}

            <View style={styles.rowFoot}>
              <Ionicons
                name={link.isPublic ? 'earth' : 'lock-closed'}
                size={14}
                color={link.isPublic ? palette.accent : palette.textDim}
              />
              <Text style={styles.footText}>{t('socialLinks.public')}</Text>
              <Switch
                value={link.isPublic}
                onValueChange={(v) => patch(i, { isPublic: v })}
                trackColor={{ true: palette.accent, false: palette.surfaceHigh }}
                thumbColor="#fff"
              />
            </View>
          </View>
        );
      })}

      <Pressable onPress={() => setPicking(true)} style={styles.addBtn} accessibilityRole="button">
        <Ionicons name="add-circle-outline" size={18} color={palette.accent} />
        <Text style={styles.addText}>{t('socialLinks.addPlatform')}</Text>
      </Pressable>

      <PrimaryButton icon="checkmark" label={t('common.save')} disabled={saving} onPress={() => void save()} />

      {/* platform-választó */}
      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPicking(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('socialLinks.pickPlatform')}</Text>
            <ScrollView contentContainerStyle={styles.grid}>
              {SOCIAL_PLATFORMS.map((p) => (
                <Pressable key={p.id} style={styles.gridItem} onPress={() => addPlatform(p.id)}>
                  <View style={styles.gridIcon}>
                    <Ionicons name={ico(p.icon)} size={20} color={palette.text} />
                  </View>
                  <Text style={styles.gridLabel} numberOfLines={1}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
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
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pLabel: { color: palette.text, fontSize: 14, fontWeight: '700' },
  iconBtn: { padding: 4 },
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
  urlPreview: { color: palette.textDim, fontSize: 12, paddingHorizontal: 2 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footText: { color: palette.textDim, fontSize: 12, flex: 1 },
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
    maxHeight: '70%',
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
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: { color: palette.textDim, fontSize: 11, textAlign: 'center' },
});
