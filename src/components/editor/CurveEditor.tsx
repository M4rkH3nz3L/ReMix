import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { palette } from '@/constants/editor';
import {
  CURVE_MAX,
  CURVE_MAX_SEGMENTS,
  CURVE_MIN,
  CURVE_MIN_SEGMENTS,
} from '@/lib/speedRamp';

const HEIGHT = 116;

/**
 * 🚀 Egyéni sebesség-görbe szerkesztő.
 *
 * A görbe szegmensenkénti SZORZÓ-sor: minden oszlop egy egyenlő forrás-szakasz
 * sebességét adja. Az oszlopot függőlegesen húzva állítod — a magasság
 * LOGARITMIKUS, mert a 0,2× és a 4× ugyanannyira „távoli" a normáltól, és
 * lineáris skálán a lassítás-tartomány összenyomódna a sáv aljára.
 *
 * A klip idővonal-hossza nem változik: a görbét a ramp normalizálja.
 */
export function CurveEditor({
  curve,
  onChange,
}: {
  curve: number[];
  onChange: (next: number[]) => void;
}) {
  /** szorzó → 0–1 magasság (log-skála, 1× a közepén) */
  const toRatio = (v: number) => {
    const lo = Math.log(CURVE_MIN);
    const hi = Math.log(CURVE_MAX);
    return (Math.log(Math.min(CURVE_MAX, Math.max(CURVE_MIN, v))) - lo) / (hi - lo);
  };
  const fromRatio = (r: number) => {
    const lo = Math.log(CURVE_MIN);
    const hi = Math.log(CURVE_MAX);
    const v = Math.exp(lo + Math.min(1, Math.max(0, r)) * (hi - lo));
    return Math.round(v * 20) / 20; // 0,05-ös lépcső
  };

  const setAt = (index: number, ratio: number) => {
    const next = [...curve];
    next[index] = fromRatio(ratio);
    onChange(next);
  };

  return (
    <View>
      <View style={styles.chart}>
        {/* 1× vonal — innen indul a gyorsítás/lassítás */}
        <View style={[styles.baseline, { bottom: toRatio(1) * HEIGHT }]} />
        {curve.map((value, i) => {
          // az oszlopot húzva állítjuk: a húzás Y-ját a sáv magasságához mérjük
          const pan = Gesture.Pan()
            .onUpdate((e) => {
              runOnJS(setAt)(i, 1 - e.y / HEIGHT);
            })
            .onEnd(() => {
              runOnJS(Haptics.selectionAsync)();
            });
          return (
            <GestureDetector key={i} gesture={pan}>
              <View style={styles.col}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(4, toRatio(value) * HEIGHT),
                      backgroundColor: value > 1.05 ? palette.accent2 : palette.accent,
                    },
                  ]}
                />
                <Text style={styles.barLabel}>{value.toFixed(2)}×</Text>
              </View>
            </GestureDetector>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Pressable
          hitSlop={6}
          style={styles.btn}
          disabled={curve.length <= CURVE_MIN_SEGMENTS}
          onPress={() => onChange(curve.slice(0, -1))}
        >
          <Ionicons
            name="remove-circle-outline"
            size={18}
            color={curve.length <= CURVE_MIN_SEGMENTS ? palette.border : palette.text}
          />
        </Pressable>
        <Text style={styles.count}>{curve.length} szakasz</Text>
        <Pressable
          hitSlop={6}
          style={styles.btn}
          disabled={curve.length >= CURVE_MAX_SEGMENTS}
          onPress={() => onChange([...curve, curve[curve.length - 1] ?? 1])}
        >
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={curve.length >= CURVE_MAX_SEGMENTS ? palette.border : palette.text}
          />
        </Pressable>
        <Pressable hitSlop={6} style={styles.btn} onPress={() => onChange(curve.map(() => 1))}>
          <Text style={styles.reset}>Kiegyenesít</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 6,
  },
  baseline: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.textDim,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: HEIGHT,
  },
  bar: {
    width: '100%',
    borderRadius: 4,
  },
  barLabel: {
    color: palette.textDim,
    fontSize: 9,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    padding: 2,
  },
  count: {
    color: palette.textDim,
    fontSize: 11,
  },
  reset: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '600',
  },
});
