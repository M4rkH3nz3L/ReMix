import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { palette } from '@/constants/editor';
import { pickAudio } from '@/lib/media';
import {
  emptySampler,
  resizeSampler,
  samplerDurationSec,
  samplerHasHits,
  toggleSamplerStep,
  type SamplerPattern,
} from '@/lib/sampler';

/** lépés-cella: 44 pt magas (Apple HIG érintési minimum) */
const CELL_W = 30;
const CELL_H = 44;

/**
 * 🎛️🔊 SAMPLER (AUDIOT §5): a felhasználó SAJÁT mintáját (one-shot) egy step-rácsra helyezi.
 * Minta kiválasztása → koppintás a lépésekre → „Sávra" (worker `/sampler` → klip). A lépés-logika
 * a pure `sampler.ts`-ben; a hang a feltöltött fájl (nem generált).
 */
export function SamplerSheet({
  bpm,
  busy,
  onClose,
  onBake,
}: {
  bpm: number;
  busy: boolean;
  onClose: () => void;
  onBake: (sampleUri: string, pattern: SamplerPattern, bars: number) => void;
}) {
  const { t } = useTranslation();
  const [bars, setBars] = useState(1);
  const [pattern, setPattern] = useState<SamplerPattern>(() => emptySampler(1));
  const [sampleUri, setSampleUri] = useState<string | null>(null);
  const [sampleName, setSampleName] = useState<string>('');
  const [picking, setPicking] = useState(false);

  const cols = pattern.map((_, i) => i);
  const durSec = samplerDurationSec(bars, bpm);

  const setBarsAndResize = (next: number) => {
    const b = Math.max(1, Math.min(4, next));
    setBars(b);
    setPattern((p) => resizeSampler(p, b));
  };

  const pick = async () => {
    if (picking) {
      return;
    }
    setPicking(true);
    try {
      const picked = await pickAudio();
      if (picked) {
        if (!picked.intake.ok) {
          return;
        }
        setSampleUri(picked.uri);
        setSampleName(picked.name);
      }
    } finally {
      setPicking(false);
    }
  };

  const canBake = !!sampleUri && samplerHasHits(pattern);

  return (
    <AudioSheetFrame id="sampler" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="color-filter" size={16} color={palette.accent} /> {t('studio.sampler.title', { defaultValue: 'Sampler' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={palette.textDim} />
        </Pressable>
      </View>

      {/* minta-választó */}
      <Pressable style={styles.pickRow} onPress={pick} disabled={picking}>
        {picking ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : (
          <Ionicons name={sampleUri ? 'musical-note' : 'cloud-upload-outline'} size={18} color={palette.accent} />
        )}
        <Text style={styles.pickText} numberOfLines={1}>
          {sampleUri ? sampleName : t('studio.sampler.pick', { defaultValue: 'Minta kiválasztása (one-shot)' })}
        </Text>
        {sampleUri ? <Ionicons name="checkmark-circle" size={16} color="#39d98a" /> : null}
      </Pressable>

      {/* vezérlők */}
      <View style={styles.controls}>
        <Pressable onPress={() => setBarsAndResize(bars - 1)} hitSlop={6} style={styles.stepBtn}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText}>{bars} {t('studio.pianoRoll.bars', { defaultValue: 'ütem' })}</Text>
        <Pressable onPress={() => setBarsAndResize(bars + 1)} hitSlop={6} style={styles.stepBtn}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={styles.info}>{bpm} BPM · {durSec.toFixed(1)}s</Text>
      </View>

      {/* egysoros step-rács */}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.row}>
          {cols.map((step) => {
            const on = pattern[step];
            const beatStart = step % 4 === 0;
            return (
              <Pressable
                key={step}
                onPress={() => setPattern((p) => toggleSamplerStep(p, step))}
                style={[
                  styles.cell,
                  beatStart && styles.cellBeat,
                  // ütemcsoport-térköz (4-esével), mint a dobgépen
                  beatStart && step > 0 && styles.cellGroupGap,
                  on && styles.cellOn,
                ]}
              />
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={() => setPattern(emptySampler(bars))} style={styles.clearBtn} disabled={!samplerHasHits(pattern)}>
          <Ionicons name="trash-outline" size={15} color={samplerHasHits(pattern) ? palette.textDim : palette.border} />
          <Text style={styles.clearText}>{t('common.clear', { defaultValue: 'Törlés' })}</Text>
        </Pressable>
        <Pressable
          onPress={() => sampleUri && onBake(sampleUri, pattern, bars)}
          disabled={busy || !canBake}
          style={[styles.bakeBtn, (busy || !canBake) && styles.disabled]}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
          <Text style={styles.bakeText}>{t('studio.pianoRoll.bake', { defaultValue: 'Sávra' })}</Text>
        </Pressable>
      </View>
    </AudioSheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 12, maxHeight: '86%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0d0f16', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: palette.border },
  pickText: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  stepBtn: { padding: 5, borderWidth: 1, borderColor: palette.border, borderRadius: 8 },
  barsText: { color: palette.text, fontSize: 13, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  info: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cell: { width: CELL_W, height: CELL_H, marginRight: 3, borderRadius: 4, borderWidth: 1, borderColor: `${palette.border}99`, backgroundColor: '#0b0d14' },
  cellBeat: { borderColor: palette.border, backgroundColor: '#11131c' },
  cellOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  cellGroupGap: { marginLeft: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  clearText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  bakeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.accent, borderRadius: 10, paddingVertical: 11 },
  bakeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
