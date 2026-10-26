import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { haptics, motion, palette, radius } from '@/design';
import { TOAST_DURATION_MS, useToast } from '@/store/toastStore';

/**
 * 🍞 A toast megjelenítője — a SZÜLŐ alján, fölé úszva (a szülő `position: relative`
 * horgony; a képernyő az eszköztár fölé teszi). Lejáratkor a SAJÁT id-jével zár,
 * így egy közben jött új toast nem tűnik el idő előtt.
 */
export function Toast() {
  const id = useToast((s) => s.id);
  const message = useToast((s) => s.message);
  const actionLabel = useToast((s) => s.actionLabel);
  const onAction = useToast((s) => s.onAction);
  const dismiss = useToast((s) => s.dismiss);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, message, dismiss]);

  if (!message) {
    return null;
  }
  return (
    <View style={styles.anchor} pointerEvents="box-none">
      <Animated.View
        key={id}
        entering={FadeInDown.duration(motion.duration.base)}
        exiting={FadeOutDown.duration(motion.duration.fast)}
        style={styles.toast}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            onPress={() => {
              haptics.selection();
              onAction();
              dismiss(id);
            }}
            hitSlop={10}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // a szülő tetejére horgonyzott, fölfelé növő sáv (a szülő fölé úszik)
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    zIndex: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 520,
    alignSelf: 'stretch',
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 8,
    borderRadius: radius.xl,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  action: { height: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.md },
  actionText: { color: palette.accent, fontSize: 14, fontWeight: '800' },
});
