import { Ionicons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import type { Remix3DRoomScanView, RoomScanHandle } from '@/lib/remix3dNative';

/** 🏠 szoba-szken (Focus): a RoomPlan élő nézete + megszakítás / kész */
export function RoomScanScreen({
  RoomView,
  roomRef,
  roomBusy,
  onCancel,
  onFinish,
}: {
  RoomView: NonNullable<typeof Remix3DRoomScanView>;
  roomRef: RefObject<RoomScanHandle | null>;
  roomBusy: boolean;
  onCancel: () => void;
  onFinish: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fill}>
      <RoomView ref={roomRef} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.fill} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.capTop} pointerEvents="box-none">
          <Pressable onPress={onCancel} hitSlop={10} style={styles.capBtn} accessibilityRole="button" accessibilityLabel={t('model3d.capture.cancel')}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.fill} pointerEvents="none" />
        <View style={styles.capBottom}>
          <Text style={styles.capHint} accessibilityLiveRegion="polite">
            {roomBusy ? t('model3d.room.saving') : t('model3d.room.hint')}
          </Text>
          {roomBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Pressable onPress={() => void onFinish()} style={styles.capPrimary} accessibilityRole="button">
              <Text style={styles.capPrimaryText}>{t('model3d.room.done')}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
