import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/components/ui/ProgressBar';
import { palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { useProgressStore } from '@/store/progressStore';

/** ilyen sűrűn frissítjük az eltelt időt/ETA-t új jelentés nélkül is */
const TICK_MS = 500;

/**
 * ⏳ Futó műveletek kártyája — a képernyő alján lebeg, NEM blokkol.
 *
 * Minden hosszú műveletnél (render, import, felirat, AI) itt látszik, hogy MI
 * fut, HOL tart (sáv + %), MENNYI elem van hátra és KB. MENNYI IDŐ. Több
 * egyidejű művelet egymás alatt jelenik meg.
 *
 * Azért nem modális, mert egy 2 perces render alatt a felhasználó nyugodtan
 * nézelődhet a projektben — a lényeg, hogy sose legyen néma várakozás.
 */
export function ProgressOverlay() {
  const { t } = useTranslation();
  const tasks = useProgressStore((s) => s.tasks);
  const tick = useProgressStore((s) => s.tick);
  const L = useLayout();

  // az ETA/eltelt idő akkor is éljen, ha épp nem érkezik új jelentés
  useEffect(() => {
    if (tasks.length === 0) {
      return;
    }
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [tasks.length, tick]);

  if (tasks.length === 0) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { padding: L.spacing.md, gap: L.spacing.sm }]}
    >
      {tasks.map((task) => (
        <View
          key={task.id}
          style={[
            styles.card,
            {
              padding: L.spacing.md,
              maxWidth: L.isCompact ? undefined : 460,
              width: L.isCompact ? undefined : '100%',
            },
          ]}
        >
          <View style={styles.headerRow}>
            <Ionicons name="sync" size={14} color={palette.accent} />
            <Text style={[styles.label, { fontSize: L.font(12) }]} numberOfLines={1}>
              {task.label}
            </Text>
            {task.cancel ? (
              <Pressable
                onPress={task.cancel}
                hitSlop={12}
                style={styles.cancel}
                accessibilityRole="button"
                accessibilityLabel={t('progressOverlay.cancelTask')}
              >
                <Ionicons name="close" size={16} color={palette.textDim} />
              </Pressable>
            ) : null}
          </View>
          <ProgressBar snapshot={task.snapshot} compact />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: palette.text,
    fontWeight: '800',
    flex: 1,
  },
  cancel: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
