import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  AUDIO_EXPORT_FORMATS,
  audioFormatInfo,
  defaultAudioQuality,
  qualityForFormat,
  type AudioExportFormat,
  type AudioExportQuality,
} from '@/lib/audioExportOptions';

/**
 * 📤 Hang Stúdió export-lap (PRO-AUDIO A27/A31): az Alert-menük helyett, mert Androidon a
 * natív Alert legfeljebb 3 gombot mutat. Előnézet, videóba vitel, és a letöltés formátummal,
 * minőséggel, mintavétellel és csatornaszámmal.
 */
export function AudioExportSheet({
  onClose,
  onPreview,
  onUseInVideo,
  onDownload,
  onDevice = false,
  onProRequired,
  range = null,
  onExportParts,
  onCheck,
}: {
  onClose: () => void;
  /** hiányzik = nincs „Előnézet” / „Videóba” gomb (pl. a videó-szerkesztőből nyitva) */
  onPreview?: () => void;
  onUseInVideo?: () => void;
  onDownload: (format: AudioExportFormat, quality: AudioExportQuality) => void;
  /** A26: Free — a WAV a telefonon készül (16 bit, 44,1 kHz, sztereó), a többi formátum Pro */
  onDevice?: boolean;
  onProRequired?: () => void;
  /** ✂️ az In–Out tartomány (mp), ha ki van jelölve */
  range?: { from: number; to: number } | null;
  /** ✂️🎚️ tartomány és/vagy sávonkénti (stem) export — WAV, a telefonon */
  onExportParts?: (scope: { range: boolean; stems: boolean }, bitDepth: 16 | 24) => void;
  /** 🩺 hangellenőrzés a telefonon (export előtt) */
  onCheck?: () => void;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<AudioExportFormat>(onDevice ? 'wav' : 'mp3');
  const [quality, setQuality] = useState<AudioExportQuality>(defaultAudioQuality(onDevice ? 'wav' : 'mp3'));
  const info = audioFormatInfo(format);
  const [useRange, setUseRange] = useState(false);
  const [stems, setStems] = useState(false);
  const parts = !!onExportParts && (useRange || stems);
  const [partsBits, setPartsBits] = useState<16 | 24>(16);
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  const pickFormat = (next: AudioExportFormat) => {
    if (onDevice && next !== 'wav') {
      onProRequired?.();
      return;
    }
    setFormat(next);
    setQuality((q) => qualityForFormat(next, q));
  };
  const set = (patch: Partial<AudioExportQuality>) => setQuality((q) => ({ ...q, ...patch }));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.close')} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>{t('studio.export')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {onPreview && onUseInVideo ? (
            <View style={styles.actions}>
              <Pressable style={styles.action} onPress={onPreview} testID="audio-export-preview">
                <Ionicons name="play-circle-outline" size={20} color={palette.accent} />
                <Text style={styles.actionText}>{t('studio.audio.exportPreview')}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={onUseInVideo} testID="audio-export-video">
                <Ionicons name="film-outline" size={20} color={palette.accent} />
                <Text style={styles.actionText}>{t('studio.audio.exportToVideo')}</Text>
              </Pressable>
            </View>
            ) : null}
            {onCheck ? (
              <Pressable style={[styles.action, { marginTop: 10 }]} onPress={onCheck} testID="audio-export-check">
                <Ionicons name="pulse-outline" size={20} color={palette.accent} />
                <Text style={styles.actionText}>{t('studio.audio.check.open')}</Text>
              </Pressable>
            ) : null}

            {onExportParts ? (
              <>
                <Text style={styles.section}>{t('studio.audio.exportSheet.scope')}</Text>
                <View style={styles.row}>
                  <Chip label={t('studio.audio.exportSheet.whole')} active={!useRange} onPress={() => setUseRange(false)} />
                  <Chip
                    label={range ? t('studio.audio.exportSheet.rangeChip', { from: mmss(range.from), to: mmss(range.to) }) : t('studio.audio.exportSheet.rangeNone')}
                    active={useRange}
                    onPress={() => range && setUseRange(true)}
                  />
                </View>
                {range ? null : <Text style={styles.hint}>{t('studio.audio.exportSheet.rangeHint')}</Text>}
                <Text style={styles.section}>{t('studio.audio.exportSheet.content')}</Text>
                <View style={styles.row}>
                  <Chip label={t('studio.audio.exportSheet.mix')} active={!stems} onPress={() => setStems(false)} />
                  <Chip label={t('studio.audio.exportSheet.stems')} active={stems} onPress={() => setStems(true)} />
                </View>
              </>
            ) : null}

            {parts ? (
              <>
                <Text style={styles.section}>{t('studio.audio.exportSheet.bitDepth')}</Text>
                <View style={styles.row}>
                  <Chip label="16 bit" active={partsBits === 16} onPress={() => setPartsBits(16)} />
                  <Chip label={onDevice ? '24 bit · PRO' : '24 bit'} active={partsBits === 24} onPress={() => (onDevice ? onProRequired?.() : setPartsBits(24))} />
                </View>
                <Text style={styles.hint}>{t(stems ? 'studio.audio.exportSheet.stemsHint' : 'studio.audio.exportSheet.rangeWavHint')}</Text>
                <View style={styles.save}>
                  <PrimaryButton
                    icon="download-outline"
                    label={t(stems ? 'studio.audio.exportSheet.saveStems' : 'studio.audio.exportSheet.saveRange')}
                    onPress={() => onExportParts?.({ range: useRange, stems }, partsBits)}
                  />
                </View>
              </>
            ) : (
              <>
            <Text style={styles.section}>{t('studio.audio.exportSheet.format')}</Text>
            <View style={styles.row}>
              {AUDIO_EXPORT_FORMATS.map((f) => (
                <Chip
                  key={f.id}
                  label={onDevice && f.id !== 'wav' ? `${f.label} · PRO` : f.label}
                  active={format === f.id}
                  onPress={() => pickFormat(f.id)}
                />
              ))}
            </View>
            <Text style={styles.hint}>
              {onDevice
                ? t('studio.audio.offline.onDeviceHint')
                : info.lossy
                  ? t('studio.audio.exportSheet.lossyHint')
                  : t('studio.audio.exportSheet.losslessHint')}
            </Text>

            {onDevice ? null : info.lossy ? (
              <>
                <Text style={styles.section}>{t('studio.audio.exportSheet.bitrate')}</Text>
                <View style={styles.row}>
                  {info.bitrates.map((kbps) => (
                    <Chip key={kbps} label={`${kbps} kbps`} active={quality.bitrateKbps === kbps} onPress={() => set({ bitrateKbps: kbps })} />
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.section}>{t('studio.audio.exportSheet.bitDepth')}</Text>
                <View style={styles.row}>
                  {([16, 24] as const).map((bits) => (
                    <Chip key={bits} label={`${bits} bit`} active={quality.bitDepth === bits} onPress={() => set({ bitDepth: bits })} />
                  ))}
                </View>
              </>
            )}

            {onDevice ? null : (
              <>
            <Text style={styles.section}>{t('studio.audio.exportSheet.sampleRate')}</Text>
            <View style={styles.row}>
              {([44100, 48000] as const).map((rate) => (
                <Chip key={rate} label={`${rate / 1000} kHz`} active={quality.sampleRate === rate} onPress={() => set({ sampleRate: rate })} />
              ))}
            </View>

            <Text style={styles.section}>{t('studio.audio.exportSheet.channels')}</Text>
            <View style={styles.row}>
              <Chip label={t('studio.audio.exportSheet.stereo')} active={quality.channels === 2} onPress={() => set({ channels: 2 })} />
              <Chip label={t('studio.audio.exportSheet.mono')} active={quality.channels === 1} onPress={() => set({ channels: 1 })} />
            </View>
              </>
            )}

            <View style={styles.save}>
              <PrimaryButton icon="download-outline" label={t('studio.audio.exportSheet.save', { format: info.label })} onPress={() => onDownload(format, quality)} />
            </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  scrim: { flex: 1 },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, maxHeight: '86%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  body: { paddingBottom: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionText: { color: palette.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { color: palette.textDim, fontSize: 12, marginTop: 8 },
  save: { marginTop: 22 },
});
