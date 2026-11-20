import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UserPresetRow } from '@/components/studio/audio/UserPresetRow';
import { clipEditStyles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { palette } from '@/constants/editor';
import { AUDIO_FX_PRESETS, presetFx } from '@/lib/audioFxPresets';
import type { AudioFx } from '@/types/project';

/** 🎛️ az effekt-blokk feje: spektrum, egy-koppintásos és saját presetek */
export function FxPresetsSection({
  fx,
  setFx,
  proFx,
  specBusy,
  spectrumUri,
  showSpectrum,
  presetsY,
}: {
  fx: AudioFx;
  setFx: (fx: AudioFx) => void;
  proFx: (apply: () => void) => void;
  specBusy: boolean;
  spectrumUri: string | null;
  showSpectrum: () => Promise<void>;
  /** 🧪 a füstteszt ide görget (a presetek sorának y-ja) */
  presetsY: { current: number };
}) {
  const { t } = useTranslation();
  return (
    <>
      <View style={clipEditStyles.divider} />
      <View style={styles.fxHead}>
        <Ionicons name="pulse-outline" size={15} color={palette.accent} />
        <Text style={styles.fxTitle}>{t('panels.audio.fxTitle')}</Text>
        <Pressable onPress={() => void showSpectrum()} hitSlop={6} style={styles.specBtn} disabled={specBusy}>
          {specBusy ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Ionicons name="stats-chart-outline" size={14} color={palette.accent} />
          )}
          <Text style={styles.specBtnText}>{t('studio.audio.spectrum', { defaultValue: 'Spektrum' })}</Text>
        </Pressable>
      </View>
      {spectrumUri ? (
        <Image source={{ uri: spectrumUri }} style={styles.spectrumImg} contentFit="contain" transition={120} />
      ) : null}
      {/* 🎙️✨ egy-koppintásos hang-FX presetek (a lenti szabályzókat előre beállítják) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow} onLayout={(e) => (presetsY.current = e.nativeEvent.layout.y)}>
        {AUDIO_FX_PRESETS.map((p) => (
          <Pressable
            key={p.key}
            testID={`audio-fx-preset-${p.key}`}
            style={styles.presetChip}
            onPress={() => proFx(() => setFx(presetFx(p.key)))}
          >
            <Ionicons name={p.icon as keyof typeof Ionicons.glyphMap} size={14} color={palette.accent} />
            <Text style={styles.presetChipText}>{t(`studio.audio.fxPreset.${p.key}`, { defaultValue: p.label })}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {/* ⭐ saját presetek: a mostani effektek mentése, egy koppintással vissza */}
      <UserPresetRow kind="clipFx" getValue={() => fx} onApply={(v) => proFx(() => setFx(JSON.parse(JSON.stringify(v))))} />
    </>
  );
}

const styles = StyleSheet.create({
  fxHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  fxTitle: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '800' },
  presetRow: { gap: 6, paddingVertical: 2, paddingRight: 8, marginBottom: 6 },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: palette.surface },
  presetChipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  specBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  specBtnText: { color: palette.accent, fontSize: 11, fontWeight: '700' },
  spectrumImg: { width: '100%', height: 150, borderRadius: 8, marginBottom: 8, backgroundColor: '#000' },
});
