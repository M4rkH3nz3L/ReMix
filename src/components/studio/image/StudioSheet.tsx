import { Ionicons } from '@expo/vector-icons';
import { createContext, type ReactNode, useContext } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { InlineSheet } from '@/components/ui/InlineSheet';
import { palette } from '@/constants/editor';
import type { Detent } from '@/lib/panelLayout';

/**
 * 📐 Az inline keret paraméterei — az `ImageStudioBody` adja (mért body →
 * `layoutBudget` → detentek). Ha nincs (vagy a lap modális), a régi Modal-keret él.
 */
export interface StudioSheetFrame {
  /** false = nem-élő feladat (export, vászon, forrás) → Modal + scrim */
  inline: boolean;
  /** iPad fekvő (expanded): a lap jobb oldali dokkolt oszlopban él, detent nélkül */
  docked?: boolean;
  detents: Record<Detent, number>;
  detent: Detent;
  onDetentChange: (detent: Detent) => void;
}

export const StudioSheetFrameContext = createContext<StudioSheetFrame | null>(null);

/**
 * 🎨 Kép-stúdió lap — a 13 szerkesztő-lap közös kerete (MOBILE-UI §6.6).
 *
 * KÉT mód, ugyanazzal az API-val (a lapok kódja nem változik):
 *  • inline (a regiszter szerint élő szerkesztés: korrekció, rétegek, stílus…):
 *    NEM-modális, detentes lap a layout-folyamban — a vászon fölötte
 *    újraméreteződik és scrim nélkül látszik, így a fényerő/kontraszt húzásának
 *    hatása élőben, nagyban követhető;
 *  • modális (export, vászon-méret, forrás): áttetsző Modal + alsó kártya + scrim.
 */
export function StudioSheet({
  title,
  icon,
  onClose,
  children,
  footer,
}: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const frame = useContext(StudioSheetFrameContext);

  const head = (
    <View style={[styles.head, frame?.inline ? styles.headInline : null]}>
      {icon ? <Ionicons name={icon} size={16} color={palette.accent} /> : null}
      <Text style={styles.title}>{title}</Text>
      <View style={{ flex: 1 }} />
      <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={title}>
        <Ionicons name="close" size={22} color={palette.text} />
      </Pressable>
    </View>
  );

  if (frame?.inline && frame.docked) {
    return (
      <View style={styles.docked}>
        {head}
        <ScrollView
          style={styles.inlineScroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? <View style={[styles.footer, styles.footerInline]}>{footer}</View> : null}
      </View>
    );
  }

  if (frame?.inline) {
    return (
      <InlineSheet
        detents={frame.detents}
        detent={frame.detent}
        onDetentChange={frame.onDetentChange}
        onClose={onClose}
        header={head}
        accessibilityLabel={title}
      >
        <ScrollView
          style={styles.inlineScroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? <View style={[styles.footer, styles.footerInline]}>{footer}</View> : null}
      </InlineSheet>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.card}>
        <View style={styles.grip} />
        {head}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  headInline: { paddingHorizontal: 16 },
  docked: {
    flex: 1,
    paddingTop: 12,
    backgroundColor: palette.surface,
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
  },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  scroll: { maxHeight: 440 },
  inlineScroll: { flex: 1, paddingHorizontal: 16 },
  scrollContent: { paddingBottom: 8, gap: 12 },
  footer: { marginTop: 10 },
  footerInline: { paddingHorizontal: 16, paddingBottom: 10, marginTop: 4 },
});
