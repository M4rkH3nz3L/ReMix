import { Ionicons } from '@expo/vector-icons';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { tempoMatchPatch, tempoResetPatch } from '@/lib/tempoMatch';
import type { AudioClip } from '@/types/project';

/** 🥁↔️ ütemhez nyújtás: a forrás-tempó léptetése, illesztés a projekt-tempóhoz, visszaállítás */
export function TempoMatchRow({
  clip,
  srcBpm,
  setSrcBpm,
  projectBpm,
  applyTempo,
}: {
  clip: AudioClip;
  srcBpm: number;
  setSrcBpm: Dispatch<SetStateAction<number>>;
  projectBpm: number;
  applyTempo: (patch: Partial<AudioClip> | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.tempoRow} testID="tempo-match">
      <Text style={styles.tempoLabel}>{t('studio.audio.tempo.source')}</Text>
      <Pressable onPress={() => setSrcBpm((b) => Math.max(20, b - 1))} style={styles.tempoBtn} hitSlop={6} accessibilityLabel="−1 BPM">
        <Ionicons name="remove" size={16} color={palette.text} />
      </Pressable>
      <Text style={styles.tempoVal}>{srcBpm}</Text>
      <Pressable onPress={() => setSrcBpm((b) => Math.min(300, b + 1))} style={styles.tempoBtn} hitSlop={6} accessibilityLabel="+1 BPM">
        <Ionicons name="add" size={16} color={palette.text} />
      </Pressable>
      <Pressable onPress={() => applyTempo(tempoMatchPatch(clip, srcBpm, projectBpm))} style={styles.tempoGo}>
        <Text style={styles.tempoGoText} numberOfLines={1} maxFontSizeMultiplier={1.3}>{t('studio.audio.tempo.match', { bpm: projectBpm })}</Text>
      </Pressable>
      {(clip.speed ?? 1) !== 1 ? (
        <Pressable onPress={() => applyTempo(tempoResetPatch(clip))} hitSlop={6} accessibilityLabel={t('studio.audio.tempo.reset')}>
          <Text style={styles.tempoSpeed}>×{(clip.speed ?? 1).toFixed(3)} ↺</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tempoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  tempoLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  tempoBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border },
  tempoVal: { color: palette.text, fontSize: 15, fontWeight: '800', minWidth: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  tempoGo: { paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 10, backgroundColor: palette.accent },
  tempoGoText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  tempoSpeed: { color: palette.accent, fontSize: 13, fontWeight: '700' },
});
