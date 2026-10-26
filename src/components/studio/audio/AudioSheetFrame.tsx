import { createContext, type ReactNode, useContext } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineSheet } from '@/components/ui/InlineSheet';
import { palette } from '@/constants/editor';
import type { Detent } from '@/lib/panelLayout';
import { AUDIO_SHEET_SPECS, type AudioSheetId } from '@/lib/panelSpecs';

/** 📐 Az inline keret paraméterei — az `AudioStudioBody` adja (mért munkaterület → detentek). */
export interface AudioSheetFrameValue {
  detents: Record<Detent, number>;
  detent: Detent;
  onDetentChange: (detent: Detent) => void;
}

export const AudioSheetFrameContext = createContext<AudioSheetFrameValue | null>(null);

/**
 * 🎚️ Hang-stúdió lap-keret (MOBILE-UI §5.3, §6.7) — a szint a regiszterből
 * (`AUDIO_SHEET_SPECS`) jön, a lapok tartalma nem változik:
 *
 *  • `sheet` (keverő, master, klip-szerkesztés): NEM-modális, detentes inline lap —
 *    a sávok és a lejátszófej fölötte látszanak, a transport végig elérhető;
 *  • `workspace` (zongoratekercs, dobgép, sampler): önálló szerkesztő-mód a TELJES
 *    stúdió-felületen (a saját fejléc ✕-e visz vissza a sávokhoz);
 *  • kontextus nélkül (vagy modális lapnál): a régi Modal + scrim keret.
 */
export function AudioSheetFrame({
  id,
  onClose,
  sheetStyle,
  tapToClose = false,
  children,
}: {
  id: AudioSheetId;
  onClose: () => void;
  /** a lap saját kártya-stílusa (modális módban teljesen, inline-ban a vízszintes padding) */
  sheetStyle: ViewStyle;
  /** modális módban a scrim-koppintás bezár */
  tapToClose?: boolean;
  children: ReactNode;
}) {
  const frame = useContext(AudioSheetFrameContext);
  const spec = AUDIO_SHEET_SPECS[id];
  const padH = StyleSheet.flatten(sheetStyle).paddingHorizontal ?? 16;

  if (frame && spec.tier === 'workspace') {
    return (
      <View style={[StyleSheet.absoluteFill, styles.workspace]}>
        <SafeAreaView edges={['top', 'bottom']} style={[styles.fill, { paddingHorizontal: padH }]}>
          {children}
        </SafeAreaView>
      </View>
    );
  }

  if (frame && spec.tier === 'sheet' && !spec.modal) {
    return (
      <InlineSheet
        detents={frame.detents}
        detent={frame.detent}
        onDetentChange={frame.onDetentChange}
        onClose={onClose}
        style={styles.inline}
      >
        <View style={[styles.fill, { paddingHorizontal: padH }]}>{children}</View>
      </InlineSheet>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {tapToClose ? <Pressable style={styles.fill} onPress={onClose} /> : null}
        <SafeAreaView edges={['bottom']} style={sheetStyle}>
          {children}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  inline: { backgroundColor: '#0b0d14' },
  workspace: { backgroundColor: palette.bg, zIndex: 10 },
});
