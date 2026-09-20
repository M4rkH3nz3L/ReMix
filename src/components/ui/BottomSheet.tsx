import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics, motion, palette, radius } from '@/design';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Ennyi lehúzás (px) VAGY ekkora sebesség (px/s) fölött a lap bezár. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 820;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** a lap maximális magassága a képernyő arányában (default 0.75) */
  maxHeightFraction?: number;
  /** háttér-elhomályosítás (default true) */
  backdrop?: boolean;
  accessibilityLabel?: string;
}

/**
 * 📄 Alsó lap (bottom sheet) — az app EGYSÉGES overlay-primitívje.
 *
 * MIÉRT: eddig minden lap (komment, értesítés, paywall) nyers `Modal
 * animationType="slide"`-dal jött — nincs spring, nincs backdrop-fade, nem lehet
 * lehúzni. Itt EGY hely adja a mozgást:
 *
 *  • belépő: a lap a saját magasságából rugóz fel (motion.spring.smooth), a
 *    backdrop finoman beúszik;
 *  • lehúzás: a fogantyút húzva a lap követi az ujjat, küszöb fölött bezár
 *    (haptika), alatta visszapattan;
 *  • kilépő: puha, gyorsuló lecsúszás — a Modal a kilépő animáció VÉGÉIG él
 *    (`rendered`), így nincs levágott animáció.
 *
 * A lap TARTALMA gyerekként jön (fejléc, lista, input) — a primitív csak a keretet
 * (backdrop + fogantyú + mozgás + biztonságos zóna) adja, hogy bármelyik felület
 * ugyanúgy morfoljon.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeightFraction = 0.75,
  backdrop = true,
  accessibilityLabel,
}: BottomSheetProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState(visible);
  const firstRun = useRef(true);
  // a belépő rugót csak az első layout (valós magasság) után indítjuk, hogy a
  // rövid lap ne a túlbecsült fallback-magasságból „ugorjon" fel
  const measured = useRef(false);

  // progress: 0 = zárt (lecsúszva) … 1 = nyitott. Ez az EGYETLEN mozgás-driver.
  const progress = useSharedValue(visible ? 1 : 0);
  // a lap mért magassága — ebből számoljuk a lecsúszás távolságát (fallback: becslés)
  const sheetH = useSharedValue(height * maxHeightFraction);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (!visible) return; // zárva indult — nincs mit animálni
    }
    if (visible) {
      // szándékos: a lap mount-ja a belépő animációhoz. A `[visible]` dep miatt
      // nem ciklizál (rendered váltása nem futtatja újra az effektet).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRendered(true);
      // ha már mértünk (nem az első nyitás), rögtön rugózunk; különben az onLayout
      // indítja a belépő rugót a VALÓS magassággal (lásd onSheetLayout)
      if (measured.current) {
        progress.value = withSpring(1, motion.spring.smooth);
      }
    } else {
      progress.value = withTiming(0, motion.timing.exit, (finished) => {
        if (finished) runOnJS(setRendered)(false);
      });
    }
    // csak a `visible` váltására fusson — a `height`-et szándékosan snapshotoljuk
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) {
      return;
    }
    sheetH.value = h;
    // első mérés nyitáskor → innen indul a belépő rugó a valós magasságból
    if (!measured.current) {
      measured.current = true;
      if (visible) {
        progress.value = withSpring(1, motion.spring.smooth);
      }
    }
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      const dy = Math.max(0, e.translationY);
      progress.value = 1 - Math.min(1, dy / sheetH.value);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        // ÖNMAGÁT unmountolja a kilépő animáció végén — nem függ attól, hogy a szülő
        // flippeli-e a `visible`-t (különben láthatatlanul mountolva maradna és
        // elnyelné az érintéseket az egész képernyőn)
        progress.value = withTiming(0, motion.timing.exit, (finished) => {
          if (finished) {
            runOnJS(setRendered)(false);
          }
        });
        runOnJS(haptics.snap)();
        runOnJS(onClose)();
      } else {
        progress.value = withSpring(1, motion.spring.smooth);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetH.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Modal visible={rendered} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {backdrop ? (
          <AnimatedPressable
            style={[styles.backdrop, backdropStyle]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
          />
        ) : null}
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: height * maxHeightFraction, paddingBottom: insets.bottom + 12 },
            sheetStyle,
          ]}
          onLayout={onSheetLayout}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.handleZone}>
              <View style={styles.grabber} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  // a fogantyú-zóna a húzható rész — bőven a 44pt-os minimum fölött
  handleZone: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: palette.border,
  },
});
