import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { meterLevel, recordingClock } from '@/lib/recordingMeter';

/**
 * 🎙️ Felvételi sáv (felvétel közben az eszköztár fölött): szünet / folytatás, bemeneti szintmérő,
 * eltelt idő (szünetben áll) és a „túl hangos” jelzés, ami a felvétel végéig megmarad.
 */
export function RecordingStrip({
  paused,
  meterDb,
  hot,
  durationMs,
  onPauseResume,
}: {
  paused: boolean;
  meterDb: number | null | undefined;
  hot: boolean;
  durationMs: number;
  onPauseResume: () => void;
}) {
  const { t } = useTranslation();
  const level = paused ? 0 : meterLevel(meterDb);
  return (
    <View style={styles.strip} testID="recording-strip">
      <Pressable onPress={onPauseResume} style={styles.btn} hitSlop={6} accessibilityRole="button" accessibilityLabel={t(paused ? 'studio.audio.rec.resume' : 'studio.audio.rec.pause')}>
        <Ionicons name={paused ? 'play' : 'pause'} size={18} color={palette.text} />
      </Pressable>
      <Text style={styles.clock}>{recordingClock(durationMs)}</Text>
      <View style={styles.meter} accessible accessibilityLabel={t('studio.audio.rec.level')} accessibilityValue={{ now: Math.round(level * 100), min: 0, max: 100 }}>
        <View style={[styles.fill, { width: `${level * 100}%`, backgroundColor: hot ? palette.danger : level > 0.85 ? '#f5a524' : '#39d98a' }]} />
      </View>
      {paused ? <Text style={styles.paused}>{t('studio.audio.rec.paused')}</Text> : null}
      {hot ? (
        <View style={styles.hot} accessibilityRole="alert">
          <Ionicons name="warning" size={14} color="#fff" />
          <Text style={styles.hotText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {t('studio.audio.rec.hot')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surfaceHigh },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.danger },
  clock: { color: palette.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 40 },
  meter: { flex: 1, height: 10, borderRadius: 5, backgroundColor: palette.surface, overflow: 'hidden' },
  fill: { height: '100%' },
  paused: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  hot: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: palette.danger, maxWidth: 220 },
  hotText: { color: '#fff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
});
