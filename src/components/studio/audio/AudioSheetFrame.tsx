import { Ionicons } from '@expo/vector-icons';
import { createContext, type ReactNode, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineSheet } from '@/components/ui/InlineSheet';
import { palette } from '@/constants/editor';
import type { Detent } from '@/lib/panelLayout';
import { AUDIO_SHEET_SPECS, type AudioSheetId } from '@/lib/panelSpecs';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';

/** 📐 Az inline keret paraméterei — az `AudioStudioBody` adja (mért munkaterület → detentek). */
export interface AudioSheetFrameValue {
  detents: Record<Detent, number>;
  detent: Detent;
  onDetentChange: (detent: Detent) => void;
  /** iPad fekvő (expanded): az inline lap jobb oldali dokkolt oszlopként, detent nélkül */
  docked?: boolean;
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
        <SafeAreaView edges={['top', 'bottom']} style={styles.fill}>
          <View style={[styles.fill, { paddingHorizontal: padH }]}>{children}</View>
          <WorkspaceTransport onBack={onClose} />
        </SafeAreaView>
      </View>
    );
  }

  if (frame?.docked && spec.tier === 'sheet' && !spec.modal) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.fill, styles.docked, { paddingHorizontal: padH }]}>
        {children}
      </SafeAreaView>
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

/**
 * ▶️ A workspace saját mini-transportja: a projekt a zongoratekercs/dobgép
 * közben is lejátszható (ugyanaz a store-óra), és egy koppintással vissza a sávokhoz
 * — a playhead és a kijelölés a store-ban él, így ugyanott folytatódik.
 */
function WorkspaceTransport({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const playhead = useEditorStore((s) => s.playhead);
  return (
    <View style={styles.wsBar}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        style={styles.wsBack}
        accessibilityRole="button"
        accessibilityLabel={t('studio.audio.backToTracks')}
      >
        <Ionicons name="chevron-back" size={18} color={palette.text} />
        <Text style={styles.wsBackText}>{t('studio.audio.backToTracks')}</Text>
      </Pressable>
      <Text style={styles.wsTime}>{formatTime(playhead)}</Text>
      <Pressable
        onPress={() => useEditorStore.getState().setPlaying(!isPlaying)}
        style={styles.wsPlay}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  wsBack: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40, flex: 1 },
  wsBackText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  wsTime: { color: palette.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wsPlay: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  inline: { backgroundColor: '#0b0d14' },
  docked: { backgroundColor: '#0b0d14', borderLeftWidth: 1, borderLeftColor: palette.border },
  workspace: { backgroundColor: palette.bg, zIndex: 10 },
});
