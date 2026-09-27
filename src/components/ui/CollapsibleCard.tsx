import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import { palette } from '@/constants/editor';

// A régi (bridge-es) Androidon a LayoutAnimation külön engedélyt kért; a New
// Architecture-ben (bridgeless) ez no-op és figyelmeztet — ott a LayoutAnimation
// alapból engedélyezett, ezért kihagyjuk a hívást. (Weben/iOS-en eleve no-op/alap.)
const RN_BRIDGELESS = (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless === true;
if (
  Platform.OS === 'android' &&
  !RN_BRIDGELESS &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * 📂 Összecsukható szekció-kártya — ikon + cím (+ alcím) fejléc, chevron, és
 * animált nyitás/zárás. A profil-szerkesztő szekcióihoz (Identitás/Személyes/
 * Creator/…), hogy a hosszú űrlap átlátható és „profi" legyen.
 */
export function CollapsibleCard({
  title,
  icon,
  subtitle,
  defaultOpen = false,
  trailing,
  children,
}: {
  title: string;
  icon: IoniconName;
  subtitle?: string;
  defaultOpen?: boolean;
  /** opcionális jobb-oldali elem a chevron elé (pl. állapot-jelvény) */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => {
    if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setOpen((o) => !o);
  };
  return (
    <View style={styles.card}>
      <Pressable onPress={toggle} style={styles.header} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={17} color={palette.accent} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {trailing}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={palette.textDim} />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1 },
  title: { color: palette.text, fontSize: 15, fontWeight: '800' },
  subtitle: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 6 },
});
