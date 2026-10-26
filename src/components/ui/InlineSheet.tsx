import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type AccessibilityActionEvent, StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { gestures, haptics, motion, palette, radius } from '@/design';
import { DETENTS, fitDetents, nearestDetent, type Detent } from '@/lib/panelLayout';

interface InlineSheetProps {
  /** a detentek px-magassága (a `layoutBudget().detents`) */
  detents: Record<Detent, number>;
  /** vezérelt detent */
  detent: Detent;
  onDetentChange: (detent: Detent) => void;
  /** lehúzás a legalsó detent alá */
  onClose: () => void;
  /** a fogantyú alatti fejléc (cím + műveletek) — ez is húzható */
  header?: ReactNode;
  /** a görgethető tartalom MÉRT magassága — a lap sosem magasabb ennél (+ fejléc) */
  contentHeight?: number;
  children: ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * 📄 Inline, detentes alsó lap — a SZERKESZTŐ-felületek primitívje (MOBILE-UI §3.2).
 *
 * MIÉRT nem a `BottomSheet`: az egy `Modal` + backdrop — kommenthez, paywallhoz
 * jó, de szerkesztés közben elsötétíti és blokkolja a vásznat. Ez a lap a
 * layout-folyam RÉSZE: a MAGASSÁGA animál (nem translateY), így a fölötte lévő
 * vászon/előnézet ugyanabban a frame-ben újraméreteződik — a kijelölt objektum és
 * a fogópontok láthatók és megfoghatók maradnak. Nincs scrim.
 *
 *  • fogantyú + fejléc húzható: a lap követi az ujjat, elengedéskor a legközelebbi
 *    detentre (gyors lendítésnél a mozgás irányába a következőre) rugózik;
 *  • a legalsó detent alá húzva bezár (ugyanazok a küszöbök, mint a BottomSheet-nél);
 *  • detent-váltáskor `haptics.snap` (E7: egységes mozgás és haptika).
 */
export function InlineSheet({
  detents: rawDetents,
  contentHeight,
  detent,
  onDetentChange,
  onClose,
  header,
  children,
  style,
  accessibilityLabel,
}: InlineSheetProps) {
  // 📏 a fogantyú+fejléc mért magassága: a tartalomhoz igazított detentekhez (fitDetents)
  const [topH, setTopH] = useState(0);
  const detents = fitDetents(
    rawDetents,
    contentHeight && topH > 0 ? topH + contentHeight + 8 : undefined
  );
  const target = detents[detent];
  // a belépő a 0-ról rugózik fel — az első render még 0 magas
  const height = useSharedValue(0);
  const closing = useRef(false);

  useEffect(() => {
    if (!closing.current) {
      height.value = withSpring(target, motion.spring.smooth);
    }
  }, [target, height]);

  const release = (h: number, velocityY: number) => {
    const next = nearestDetent(detents, h, velocityY);
    // ugyanarra a detentre esett vissza → a prop nem változik, nekünk kell visszarugózni
    height.value = withSpring(detents[next], motion.spring.smooth);
    if (next !== detent) {
      haptics.snap();
      onDetentChange(next);
    }
  };

  const close = () => {
    closing.current = true;
    haptics.snap();
    onClose();
  };

  // 🧲 küszöbök RENDER-időben olvasva (lásd BottomSheet: HMR-biztos barrel-olvasás)
  const dismissDistance = gestures.sheet.dismissDistance;
  const dismissVelocity = gestures.sheet.dismissVelocity;
  const lowest = detents.peek;
  const highest = detents.full;
  const start = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onBegin(() => {
      start.value = height.value;
    })
    .onUpdate((e) => {
      const h = start.value - e.translationY;
      // a legfelső detent fölött gumiszalag-ellenállás
      height.value = h > highest ? highest + (h - highest) * 0.25 : Math.max(0, h);
    })
    .onEnd((e) => {
      const h = height.value;
      const belowLowest = lowest - h;
      if (belowLowest > dismissDistance * 0.6 || (e.velocityY > dismissVelocity && h <= lowest + 8)) {
        height.value = withTiming(0, motion.timing.exit, (finished) => {
          if (finished) {
            runOnJS(close)();
          }
        });
        return;
      }
      runOnJS(release)(h, e.velocityY);
    });

  const sheetStyle = useAnimatedStyle(() => ({ height: height.value }));

  // ♿ akadálymentes detent-váltás (VoiceOver/TalkBack „adjustable")
  const order = DETENTS.filter((d, i) => i === 0 || detents[d] !== detents[DETENTS[i - 1]]);

  // 👆 a fogantyúra KOPPINTÁS a következő detentre lép (peek → half → full → peek) —
  // iOS-en ezt várja a kéz; a húzás ettől függetlenül él
  const cycleDetent = () => {
    if (order.length < 2) {
      return;
    }
    const next = order[(order.indexOf(detent) + 1) % order.length];
    haptics.snap();
    onDetentChange(next);
  };
  const tap = Gesture.Tap()
    .maxDistance(6)
    .onEnd((_e, success) => {
      if (success) {
        runOnJS(cycleDetent)();
      }
    });
  const onA11yAction = (e: AccessibilityActionEvent) => {
    const i = order.indexOf(detent);
    if (e.nativeEvent.actionName === 'increment' && i < order.length - 1) {
      onDetentChange(order[i + 1]);
    } else if (e.nativeEvent.actionName === 'decrement') {
      if (i > 0) {
        onDetentChange(order[i - 1]);
      } else {
        onClose();
      }
    }
  };

  return (
    <Animated.View style={[styles.sheet, style, sheetStyle]}>
      <GestureDetector gesture={pan}>
        <View onLayout={(e) => setTopH(e.nativeEvent.layout.height)}>
          <GestureDetector gesture={tap}>
            <View
              style={styles.handleZone}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={accessibilityLabel}
              accessibilityValue={{ text: detent }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={onA11yAction}
            >
              <View style={styles.grabber} />
            </View>
          </GestureDetector>
          {header}
        </View>
      </GestureDetector>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: palette.border,
  },
  // a fogantyú-zóna: koppintható/húzható — 24 pt magas, a fejléccel együtt bőven 44 pt fölött
  handleZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: palette.border,
  },
  body: { flex: 1 },
});
