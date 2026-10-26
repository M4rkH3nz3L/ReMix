import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { palette } from '@/constants/editor';
import { motion, radius } from '@/design';

/**
 * 🎯 Focus-króm — a precíziós mód kerete (MOBILE-UI §3.3).
 *
 * A vászon a TELJES body-t kapja (a fejléc, a transport, az idővonal és az
 * eszköztár rejtve); ez a króm a vászon FÖLÉ úszik, `box-none`-nal, így a vászon
 * gesztusai (húzás, csippentés) végig élnek:
 *
 *  • felül egy vékony sáv: cím + egyértelmű „Kész" (kilépés a teljes szerkesztőbe);
 *  • alul a paraméterek áttetsző, lebegő kártyán — összecsukható, hogy a kijelölt
 *    objektum alatta se legyen takarva. A kártya legfeljebb a body ~40%-a.
 *
 * A módosítások a command buson már élőben commitolódnak (mint a panelekben),
 * ezért a „Kész" csak kilép — nincs külön „elvetés" állapot.
 */
export function FocusChrome({
  title,
  onDone,
  children,
}: {
  title: string;
  onDone: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        entering={FadeIn.duration(motion.duration.base)}
        exiting={FadeOut.duration(motion.duration.fast)}
        style={styles.topBar}
      >
        <Ionicons name="scan-outline" size={16} color={palette.accent} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={onDone}
          hitSlop={10}
          style={styles.done}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
        >
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </Animated.View>

      <View style={styles.flex} pointerEvents="box-none" />

      <Animated.View entering={FadeIn.duration(motion.duration.base)} style={styles.card}>
        <Pressable
          onPress={() => setCollapsed((c) => !c)}
          hitSlop={8}
          style={styles.cardHead}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={t('editor.panelHost.focusParams')}
        >
          <Text style={styles.cardTitle}>{t('editor.panelHost.focusParams')}</Text>
          <Ionicons name={collapsed ? 'chevron-up' : 'chevron-down'} size={16} color={palette.textDim} />
        </Pressable>
        {collapsed ? null : (
          <ScrollView style={styles.cardBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 8,
    paddingLeft: 12,
    paddingRight: 6,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(20,20,28,0.85)',
    borderWidth: 1,
    borderColor: palette.border,
  },
  title: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '700' },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  doneText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  card: {
    margin: 8,
    maxHeight: '40%',
    borderRadius: radius.xl,
    backgroundColor: 'rgba(20,20,28,0.88)',
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 40,
  },
  cardTitle: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  cardBody: { paddingHorizontal: 14 },
});
