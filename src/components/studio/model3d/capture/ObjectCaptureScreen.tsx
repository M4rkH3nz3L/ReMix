import { Ionicons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { capturePrimaryKey, captureStuckHintKey } from '@/lib/model3dStudioOps';
import type { CaptureStateEvent, CaptureViewHandle, Remix3DCaptureView } from '@/lib/remix3dNative';

/** 🎯 objektum-rögzítés (Focus: teljes képernyő, élő útmutatás, fő gomb az állapot szerint) */
export function ObjectCaptureScreen({
  CaptureView,
  captureRef,
  capState,
  initElapsed,
  onCaptureState,
  onCancel,
  onPrimary,
}: {
  CaptureView: NonNullable<typeof Remix3DCaptureView>;
  captureRef: RefObject<CaptureViewHandle | null>;
  capState: CaptureStateEvent;
  initElapsed: number;
  onCaptureState: (e: CaptureStateEvent) => void;
  onCancel: () => void;
  onPrimary: () => void;
}) {
  const { t } = useTranslation();
  const fb = capState.feedback[0];
  const stuckKey = captureStuckHintKey(capState.state, initElapsed);
  const stuckHint = stuckKey !== null ? t(stuckKey) : null;
  const hint =
    stuckHint ??
    (fb
      ? t(`model3d.feedback.${fb}`, { defaultValue: t(`model3d.capture.hint_${capState.state}`) })
      : t(`model3d.capture.hint_${capState.state}`, { defaultValue: '' }));
  const primaryKey = capturePrimaryKey(capState.state);
  const primaryLabel = primaryKey !== null ? t(primaryKey) : null;
  return (
    <View style={styles.fill}>
      <CaptureView ref={captureRef} style={StyleSheet.absoluteFill} onCaptureState={(ev) => onCaptureState(ev.nativeEvent)} />
      <SafeAreaView style={styles.fill} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.capTop} pointerEvents="box-none">
          <Pressable onPress={onCancel} hitSlop={10} style={styles.capBtn} accessibilityRole="button" accessibilityLabel={t('model3d.capture.cancel')}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.fill} pointerEvents="none" />
        <View style={styles.capBottom}>
          {hint ? (
            <Text style={styles.capHint} accessibilityLiveRegion="polite">
              {hint}
            </Text>
          ) : null}
          <View style={styles.capRow}>
            {capState.state === 'capturing' ? (
              <Pressable onPress={() => void captureRef.current?.command('newPass')} style={styles.capSecondary} accessibilityRole="button">
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.capSecondaryText}>{t('model3d.capture.newPass')}</Text>
              </Pressable>
            ) : null}
            {primaryLabel ? (
              <Pressable onPress={onPrimary} style={styles.capPrimary} accessibilityRole="button">
                <Text style={styles.capPrimaryText}>{primaryLabel}</Text>
              </Pressable>
            ) : (
              <ActivityIndicator color="#fff" />
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
