import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { shared } from '@/components/live/studio/liveStudioStyles';
import { palette } from '@/constants/editor';
import { goBackOrHome } from '@/lib/nav';

/** A Live Studio kerete (REFACTOR: a src/app/live/studio/[id].tsx-ből): betöltési
 *  állapotok, fejléc (vissza + cím) és az akció-sáv („Start streaming”). */

/** betöltési hiba → vissza */
export function LiveStudioLoadError() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={shared.container}>
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={44} color={palette.border} />
        <Text style={styles.dim}>{t('common.error')}</Text>
        <Pressable style={styles.secondaryBtn} onPress={() => goBackOrHome()}>
          <Text style={styles.secondaryText}>{t('live.leave')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** betöltés alatt */
export function LiveStudioLoading() {
  return (
    <SafeAreaView style={shared.container}>
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
      </View>
    </SafeAreaView>
  );
}

export interface LiveStudioTopBarProps {
  onCancel: () => void;
  titleDraft: string;
  setTitleDraft: (v: string) => void;
  onTitleEnd: () => void;
}

/** fejléc: vissza (= a live megszakítása), cím-mező, Studio-jelvény */
export function LiveStudioTopBar({ onCancel, titleDraft, setTitleDraft, onTitleEnd }: LiveStudioTopBarProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onCancel} hitSlop={10} style={styles.iconBtn}>
        <Ionicons name="chevron-back" size={24} color={palette.text} />
      </Pressable>
      <TextInput
        value={titleDraft}
        onChangeText={setTitleDraft}
        onEndEditing={onTitleEnd}
        placeholder={t('live.titlePlaceholder', { defaultValue: "What's your live about?" })}
        placeholderTextColor={palette.textDim}
        style={styles.titleInput}
        maxLength={120}
      />
      <View style={styles.liveStudioBadge}>
        <Ionicons name="radio" size={13} color="#fff" />
        <Text style={styles.liveStudioBadgeText}>Studio</Text>
      </View>
    </View>
  );
}

export interface StartStreamBarProps {
  starting: boolean;
  onStart: () => void;
}

/** akció-sáv: „Start streaming” (indítás közben pörgő, tiltott) */
export function StartStreamBar({ starting, onStart }: StartStreamBarProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.actionBar}>
      <Pressable onPress={onStart} disabled={starting} style={[styles.startBtn, starting && shared.startBtnDisabled]}>
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="radio" size={18} color="#fff" />
            <Text style={styles.startText}>{t('live.studio.startStreaming', { defaultValue: 'Start streaming' })}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  dim: { color: palette.textDim, fontSize: 15, fontWeight: '700' },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  iconBtn: { padding: 2 },
  titleInput: { flex: 1, color: palette.text, fontSize: 16, fontWeight: '700' },
  liveStudioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveStudioBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  actionBar: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.danger,
    borderRadius: 14,
    paddingVertical: 15,
  },
  startText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  secondaryBtn: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: palette.text, fontSize: 14, fontWeight: '700' },
});
