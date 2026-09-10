import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { accentGradient, palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { formatCount, formatEta, formatPercent, type ProgressSnapshot } from '@/lib/progress';

/**
 * Determinált előrehaladás-sáv: MIT csinál · HOL tart · MENNYI van hátra.
 *
 * Ha az arány ismert, a sáv kitöltése animálva követi (nem ugrik), és látszik
 * a százalék + a becsült hátralévő idő. Ha nem mérhető, egy oda-vissza futó
 * csík jelzi, hogy dolgozik — de a FÁZIS ilyenkor is olvasható, hogy sose
 * legyen néma „valami történik" állapot.
 */
export function ProgressBar({
  snapshot,
  label,
  compact,
}: {
  snapshot: ProgressSnapshot;
  /** a művelet neve a fázis fölött (pl. „Export") */
  label?: string;
  /** szűk helyre: csak a sáv + egy sor */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const L = useLayout();
  const fill = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const { ratio, indeterminate } = snapshot;

  // determinált: a kitöltés simán fut az új értékre
  useEffect(() => {
    if (ratio == null) {
      return;
    }
    Animated.timing(fill, {
      toValue: ratio,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [ratio, fill]);

  // határozatlan: oda-vissza futó csík
  useEffect(() => {
    if (!indeterminate) {
      return;
    }
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      sweep.setValue(0);
    };
  }, [indeterminate, sweep]);

  const percent = formatPercent(ratio);
  const count = formatCount(snapshot);
  const eta = formatEta(snapshot.etaSec);

  // a jobb oldali „mennyi van hátra" sor: 3/8 klip · 42% · ~1 p 20 mp
  const right = [count, percent].filter(Boolean).join(' · ');

  return (
    <View style={{ gap: L.spacing.xs }}>
      {label && !compact ? (
        <Text style={[styles.label, { fontSize: L.font(11) }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}

      <View style={styles.track}>
        {indeterminate ? (
          <Animated.View
            style={[
              styles.sweep,
              {
                left: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['-35%', '100%'],
                }),
              },
            ]}
          >
            <LinearGradient
              colors={[...accentGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.flatten([styles.fillInner])}
            />
          </Animated.View>
        ) : (
          <Animated.View
            style={[
              styles.fill,
              {
                width: fill.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          >
            <LinearGradient
              colors={[...accentGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.flatten([styles.fillInner])}
            />
          </Animated.View>
        )}
      </View>

      <View style={styles.metaRow}>
        <Text
          style={[styles.phase, { fontSize: L.font(11) }]}
          numberOfLines={1}
        >
          {snapshot.phase || t('progressBar.working')}
        </Text>
        {right ? (
          <Text style={[styles.meta, { fontSize: L.font(11) }]}>{right}</Text>
        ) : null}
      </View>

      {eta ? (
        <Text style={[styles.eta, { fontSize: L.font(10) }]}>
          {eta === t('lib.progress.etaAlmostDone') ? t('progressBar.almostDone') : t('progressBar.etaRemaining', { eta })}
        </Text>
      ) : null}
    </View>
  );
}

const BAR_HEIGHT = 6;

const styles = StyleSheet.create({
  label: {
    color: palette.text,
    fontWeight: '800',
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '35%',
  },
  fillInner: {
    flex: 1,
    borderRadius: BAR_HEIGHT / 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  phase: {
    color: palette.text,
    fontWeight: '600',
    flex: 1,
  },
  meta: {
    color: palette.textDim,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  eta: {
    color: palette.textDim,
    fontVariant: ['tabular-nums'],
  },
});
