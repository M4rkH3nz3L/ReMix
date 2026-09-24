import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/ui/PressableScale';
import { PrimaryButton } from '@/components/ui/controls';
import { palette, radius } from '@/design';
import {
  addGroupMember,
  createGroup,
  listFollowingPeers,
  type ChatPeer,
} from '@/lib/chat';

/**
 * 👥 Csoport-létrehozó / tag-hozzáadó lap. A jelölt-halmaz azok, akiket KÖVETEK
 * (nincs nyilvános user-kereső — GDPR). `create` módban név + tagok → új csoport;
 * `add` módban a kiválasztottakat egy meglévő csoporthoz adja.
 */
export function GroupCreateSheet({
  visible,
  onClose,
  mode,
  conversationId,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  mode: 'create' | 'add';
  conversationId?: string;
  onDone: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<ChatPeer[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    // szándékos: a lap MEGNYÍLÁSAKOR reset + a jelöltek (követettek) betöltése
    /* eslint-disable react-hooks/set-state-in-effect */
    setTitle('');
    setSelected(new Set());
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    listFollowingPeers()
      .then(setCandidates)
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const confirm = async () => {
    if (selected.size === 0 || busy) {
      return;
    }
    setBusy(true);
    try {
      let cid = conversationId ?? '';
      if (mode === 'create') {
        cid = await createGroup(title, [...selected]);
      } else if (conversationId) {
        for (const id of selected) {
          await addGroupMember(conversationId, id);
        }
      }
      onClose();
      if (cid) {
        onDone(cid);
      }
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      maxHeightFraction={0.82}
      accessibilityLabel={t(mode === 'create' ? 'chat.newGroup' : 'chat.addPeople')}
    >
      <View style={styles.body}>
        <Text style={styles.title}>{t(mode === 'create' ? 'chat.newGroup' : 'chat.addPeople')}</Text>
        {mode === 'create' ? (
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('chat.groupNamePlaceholder')}
            placeholderTextColor={palette.textDim}
            maxLength={60}
          />
        ) : null}

        {loading ? (
          <Text style={styles.hint}>{t('common.loading')}</Text>
        ) : candidates.length === 0 ? (
          <Text style={styles.hint}>{t('chat.noFollowing')}</Text>
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {candidates.map((p) => {
              const on = selected.has(p.id);
              return (
                <PressableScale key={p.id} style={styles.row} onPress={() => toggle(p.id)}>
                  <View style={styles.avatar}>
                    {p.avatar ? (
                      <Image source={{ uri: p.avatar }} style={styles.avatarImg} contentFit="cover" />
                    ) : (
                      <Text style={styles.avatarText}>{(p.name || '?').slice(0, 1).toUpperCase()}</Text>
                    )}
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.name || t('chat.someone')}
                  </Text>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? palette.accent : palette.textDim}
                  />
                </PressableScale>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label={t(mode === 'create' ? 'chat.createGroup' : 'chat.addSelected', { count: selected.size })}
            icon={mode === 'create' ? 'people' : 'person-add'}
            onPress={confirm}
            disabled={selected.size === 0 || busy}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: 6, gap: 10 },
  title: { color: palette.text, fontSize: 18, fontWeight: '800' },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
  },
  hint: { color: palette.textDim, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  list: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  name: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '600' },
  footer: { paddingTop: 4 },
});
