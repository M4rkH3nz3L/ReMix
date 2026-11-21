import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { LiveEvent, LiveState } from '@/lib/liveState';

/**
 * 🚦 Az élő adás hiba-sávja (REFACTOR: a src/app/live/[id].tsx-ből): mi történt + mit tehet
 * (újrapróba / befejezés). A gyökér csak `ls.phase === 'error'` esetén rendereli.
 */

export interface LiveErrorBannerProps {
  ls: LiveState;
  isHost: boolean;
  dispatchLs: Dispatch<LiveEvent>;
  setStageKey: Dispatch<SetStateAction<number>>;
  onEndOrLeave: () => Promise<void>;
}

export function LiveErrorBanner({ ls, isHost, dispatchLs, setStageKey, onEndOrLeave }: LiveErrorBannerProps) {
  const { t } = useTranslation();
  return (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{t(`live.state.error_${ls.error ?? 'unknown'}`)}</Text>
            <View style={styles.errorActions}>
              {ls.error === 'reconnectTimeout' ? (
                <Pressable
                  style={styles.errorBtn}
                  onPress={() => {
                    dispatchLs({ type: 'RETRY', at: Date.now() });
                    setStageKey((k) => k + 1);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.errorBtnText}>{t('live.state.retry')}</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.errorBtn, styles.errorBtnDanger]} onPress={() => void onEndOrLeave()} accessibilityRole="button">
                <Text style={styles.errorBtnText}>{isHost ? t('live.endLive') : t('live.leave')}</Text>
              </Pressable>
            </View>
          </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#3a0d14ee',
    borderWidth: 1,
    borderColor: palette.danger,
    gap: 10,
  },
  errorText: { color: '#fff', fontSize: 14, lineHeight: 19, fontWeight: '600' },
  errorActions: { flexDirection: 'row', gap: 10 },
  errorBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff22',
  },
  errorBtnDanger: { backgroundColor: palette.danger },
  errorBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
