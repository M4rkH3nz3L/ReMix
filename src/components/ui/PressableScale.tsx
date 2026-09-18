import { type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { motion } from '@/design';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** a lenyomott állapot mérete (default 0.96) */
  pressedScale?: number;
  children?: ReactNode;
};

/**
 * 🎯 Nyomható elem finom „press" visszajelzéssel: lenyomásra rugósan összehúzódik
 * (motion.spring.snappy), elengedésre visszapattan. Ez adja a gomboknak a prémium,
 * tapintható érzést — a felület azonnal reagál az ujjra.
 *
 * A sima `Pressable` helyett bárhol használható (a `style` a lenyomás-scale ALÁ
 * kerül, így az árnyék/gradiens is együtt mozog). Letiltott elem nem reagál (a
 * Pressable eleve nem tüzeli az onPressIn-t).
 */
export function PressableScale({
  pressedScale = 0.96,
  onPressIn,
  onPressOut,
  style,
  children,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      onPressIn={(e) => {
        scale.value = withSpring(pressedScale, motion.spring.snappy);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring.snappy);
        onPressOut?.(e);
      }}
      style={[style, aStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
