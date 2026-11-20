import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clipEditStyles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { palette } from '@/constants/editor';
import { fxStageActive } from '@/lib/clipEditOps';
import { fxStageOrder, moveStage, type FxStage } from '@/lib/fxOrder';
import type { AudioFx } from '@/types/project';

/** 🔀 effekt-sorrend: az aktív fokozatok a lánc sorrendjében, léptetéssel (előnézet = export) */
export function FxOrderSection({ fx, patchFx }: { fx: AudioFx; patchFx: (p: Partial<AudioFx>) => void }) {
  const { t } = useTranslation();
  const activeStage = (st: FxStage) => fxStageActive(fx, st);
  const order = fxStageOrder(fx.order).filter(activeStage);
  if (order.length < 2) return null;
  return (
    <View style={styles.orderBox} testID="fx-order">
      <Text style={clipEditStyles.autoLabel}>{t('studio.audio.fxOrder.title')}</Text>
      {order.map((st, i) => (
        <View key={st} style={styles.orderRow}>
          <Text style={styles.orderName}>{`${i + 1}. ${t(`studio.audio.fxOrder.stage.${st}`)}`}</Text>
          <Pressable onPress={() => patchFx({ order: moveStage(fx.order, st, -1) })} disabled={i === 0} hitSlop={6} style={[styles.orderBtn, i === 0 && { opacity: 0.3 }]} accessibilityLabel={t('studio.audio.fxOrder.up')}>
            <Ionicons name="chevron-up" size={16} color={palette.text} />
          </Pressable>
          <Pressable onPress={() => patchFx({ order: moveStage(fx.order, st, 1) })} disabled={i === order.length - 1} hitSlop={6} style={[styles.orderBtn, i === order.length - 1 && { opacity: 0.3 }]} accessibilityLabel={t('studio.audio.fxOrder.down')}>
            <Ionicons name="chevron-down" size={16} color={palette.text} />
          </Pressable>
        </View>
      ))}
      <Text style={clipEditStyles.hint}>{t('studio.audio.fxOrder.hint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  orderBox: { marginTop: 8, gap: 6 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10 },
  orderName: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  orderBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border },
});
