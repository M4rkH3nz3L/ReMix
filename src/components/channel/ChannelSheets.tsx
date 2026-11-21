import { router } from 'expo-router';
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

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { promoteBudget, promoteTargetViews } from '@/lib/channelScreen';
import type { FeedPost } from '@/types/social';

/**
 * A csatorna-képernyő alulról nyíló lapjai (REFACTOR: a src/app/channel/[id].tsx-ből):
 * a saját poszt kiemelése (promóció) és a remix-felügyelet.
 */

/** — kiemelés (promóció) modal — */
export function PromoteSheet({
  promoteFor,
  setPromoteFor,
  budget,
  setBudget,
  cpv,
  setCpv,
  busy,
  doPromote,
}: {
  promoteFor: FeedPost | null;
  setPromoteFor: (post: FeedPost | null) => void;
  budget: string;
  setBudget: (v: string) => void;
  cpv: string;
  setCpv: (v: string) => void;
  busy: boolean;
  doPromote: () => void;
}) {
  const { t } = useTranslation();
  const targetViews = promoteTargetViews(budget, cpv);
  return (
    <Modal
      visible={promoteFor !== null}
      transparent
      animationType="slide"
      onRequestClose={() => setPromoteFor(null)}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPromoteFor(null)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t('promote.cta')}</Text>
          <Text style={styles.sheetHint}>{t('promote.hint')}</Text>
          <Text style={styles.fieldLabel}>{t('promote.budget')}</Text>
          <TextInput
            style={styles.input}
            value={budget}
            onChangeText={setBudget}
            keyboardType="number-pad"
            placeholderTextColor={palette.textDim}
          />
          <Text style={styles.fieldLabel}>{t('promote.costPerView')}</Text>
          <TextInput
            style={styles.input}
            value={cpv}
            onChangeText={setCpv}
            keyboardType="number-pad"
            placeholderTextColor={palette.textDim}
          />
          <Text style={styles.targetText}>{t('promote.target', { views: targetViews })}</Text>
          <View style={{ marginTop: 10 }}>
            <PrimaryButton
              label={t('promote.confirm', { budget: promoteBudget(budget) })}
              icon="megaphone-outline"
              onPress={doPromote}
              disabled={busy || targetViews < 1}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** — 🔀 remix-felügyelet modal (az eredeti tulaj moderálja a remixeket) — */
export function RemixModerationSheet({
  remixFor,
  setRemixFor,
  remixLoading,
  remixes,
  doModerate,
}: {
  remixFor: FeedPost | null;
  setRemixFor: (post: FeedPost | null) => void;
  remixLoading: boolean;
  remixes: FeedPost[];
  doModerate: (remix: FeedPost, status: 'removed' | 'ok') => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={remixFor !== null}
      transparent
      animationType="slide"
      onRequestClose={() => setRemixFor(null)}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setRemixFor(null)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t('channel.remixMod.title')}</Text>
          <Text style={styles.sheetHint}>{t('channel.remixMod.hint')}</Text>
          {remixLoading ? (
            <ActivityIndicator color={palette.accent} style={{ marginVertical: 24 }} />
          ) : remixes.length === 0 ? (
            <Text style={styles.remixEmpty}>{t('channel.remixMod.empty')}</Text>
          ) : (
            <FlatList
              data={remixes}
              keyExtractor={(r) => r.id}
              style={{ maxHeight: 340 }}
              renderItem={({ item }) => {
                const removed = item.moderationStatus === 'removed';
                return (
                  <Pressable
                    style={styles.remixRow}
                    onPress={() => router.push(`/channel/${item.creator.id}`)}
                  >
                    <View style={styles.remixInfo}>
                      <Text style={styles.remixTitle} numberOfLines={1}>
                        @{item.creator.username}
                      </Text>
                      <Text style={styles.remixSub} numberOfLines={1}>
                        {removed ? t('channel.remixMod.removedLabel') : item.title}
                      </Text>
                    </View>
                    <Pressable
                      style={[styles.remixBtn, removed ? styles.remixRestore : styles.remixRemove]}
                      onPress={() => doModerate(item, removed ? 'ok' : 'removed')}
                      hitSlop={6}
                    >
                      <Text style={styles.remixBtnText}>
                        {removed ? t('channel.remixMod.restore') : t('channel.remixMod.remove')}
                      </Text>
                    </Pressable>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    gap: 8,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  sheetTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  sheetHint: { color: palette.textDim, fontSize: 13, lineHeight: 18 },
  fieldLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginTop: 6 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
  },
  targetText: { color: palette.accent, fontSize: 14, fontWeight: '700', marginTop: 8 },
  remixEmpty: { color: palette.textDim, textAlign: 'center', paddingVertical: 24 },
  remixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: palette.border,
  },
  remixInfo: { flex: 1 },
  remixTitle: { color: palette.text, fontSize: 14, fontWeight: '700' },
  remixSub: { color: palette.textDim, fontSize: 12, marginTop: 1 },
  remixBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  remixRemove: { backgroundColor: palette.danger },
  remixRestore: { backgroundColor: palette.accent },
  remixBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
