import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PreviewPlayButton } from '@/components/studio/audio/PreviewPlayButton';
import { palette } from '@/constants/editor';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { logCaught } from '@/lib/logCaught';
import type { AudioClip, AudioTake } from '@/types/project';

/** a take hangja (a klipben szóló szakasz) előhallgatáshoz */
async function takePcm(take: AudioTake): Promise<Float32Array[] | null> {
  const api = await loadAudioApi();
  if (!api) return null;
  try {
    const buf = await api.decodeAudioData(take.uri, 44100);
    const a = Math.round(take.trimIn * 44100);
    const b = Math.min(buf.length, a + Math.round(take.duration * 44100));
    return Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice(a, b));
  } catch (caught) {
    logCaught('components/studio/audio/TakePicker.tsx:takePcm', caught);
    return null;
  }
}

/**
 * 🎙️🔁 Take-választó (klipszerkesztő): ugyanarra a helyre felvett take-ek, mindegyik előhallgatható;
 * a koppintás a választott take-et teszi aktívvá (egy visszavonható lépés).
 */
export function TakePicker({ clip, onSelect }: { clip: AudioClip; onSelect: (takeId: string) => void }) {
  const { t } = useTranslation();
  const takes = clip.takes ?? [];
  if (takes.length < 2) return null;
  return (
    <View style={styles.wrap} testID="take-picker">
      <Text style={styles.title}>{t('studio.audio.rec.takes', { count: takes.length })}</Text>
      {takes.map((take, i) => {
        const active = take.id === clip.activeTake;
        return (
          <View key={take.id} style={[styles.row, active && styles.rowActive]}>
            <Pressable style={styles.pick} onPress={() => onSelect(take.id)} disabled={active} accessibilityRole="radio" accessibilityState={{ selected: active }}>
              <Text style={[styles.name, active && styles.nameActive]}>{t('studio.audio.rec.take', { n: i + 1 })}</Text>
              {active ? <Text style={styles.badge}>{t('studio.audio.rec.activeTake')}</Text> : null}
            </Pressable>
            <PreviewPlayButton build={() => takePcm(take)} version={take.id} testID={`take${i + 1}`} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 12 },
  title: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44 },
  rowActive: { borderColor: palette.accent, backgroundColor: palette.surfaceHigh },
  pick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  name: { color: palette.text, fontSize: 14, fontWeight: '600' },
  nameActive: { color: palette.accent },
  badge: { color: palette.accent, fontSize: 11, fontWeight: '700' },
});
