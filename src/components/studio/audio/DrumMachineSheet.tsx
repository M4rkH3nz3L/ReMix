import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { palette } from '@/constants/editor';
import {
  DRUM_LABEL,
  DRUM_VOICES,
  emptyPattern,
  hasHits,
  patternDurationSec,
  patternHits,
  STEPS_PER_BAR,
  stepCount,
  toggleStep,
  type DrumHit,
  type DrumPattern,
} from '@/lib/drums';

/** lépés-cella: 44 pt magas (Apple HIG érintési minimum) — a workspace-ben van rá hely */
const CELL_W = 30;
const CELL_H = 44;

/**
 * 🥁 DOB-GÉP (AUDIOT §5): step-sequencer rács (hangok × 16-od lépések). Koppintás = ütés be/ki.
 * A „Sávra" a worker `/drums`-án szintetizált dob-mintává rendereli (nincs minta-fájl-függés),
 * és a Hang Stúdió sima klipként teszi a sávra. A lépés-logika a pure `drums.ts`-ben.
 */
export function DrumMachineSheet({
  bpm,
  busy,
  onClose,
  onBake,
}: {
  bpm: number;
  busy: boolean;
  onClose: () => void;
  onBake: (hits: DrumHit[], bars: number) => void;
}) {
  const { t } = useTranslation();
  const [bars, setBars] = useState(1);
  const [pattern, setPattern] = useState<DrumPattern>(() => emptyPattern(1));

  const steps = stepCount(bars);
  const cols = Array.from({ length: steps }, (_, i) => i);
  const durSec = patternDurationSec(bars, bpm);

  const setBarsAndResize = (next: number) => {
    const b = Math.max(1, Math.min(4, next));
    setBars(b);
    // a rács átméretezése a meglévő ütések megőrzésével
    setPattern((prev) => {
      const fresh = emptyPattern(b);
      for (const v of DRUM_VOICES) {
        const row = fresh[v];
        (prev[v] ?? []).forEach((on, i) => {
          if (i < row.length) {
            row[i] = on;
          }
        });
      }
      return fresh;
    });
  };

  return (
    <AudioSheetFrame id="drumMachine" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="grid" size={16} color={palette.accent} /> {t('studio.drums.title', { defaultValue: 'Dob-gép' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={palette.textDim} />
        </Pressable>
      </View>

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

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {DRUM_VOICES.map((voice) => (
            <View key={voice} style={styles.row}>
              <View style={styles.rowLabel}>
                <Text style={styles.rowLabelText}>{DRUM_LABEL[voice]}</Text>
              </View>
              {cols.map((step) => {
                const on = pattern[voice]?.[step];
                const beatStart = step % 4 === 0;
                return (
                  <Pressable
                    key={step}
                    onPress={() => setPattern((p) => toggleStep(p, voice, step))}
                    style={[
                      styles.cell,
                      beatStart && styles.cellBeat,
                      // ütemcsoport-térköz (4-esével) — a rács ránézésre olvasható, mint egy hardveres dobgépen
                      beatStart && step > 0 && styles.cellGroupGap,
                      on && styles.cellOn,
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={() => setPattern(emptyPattern(bars))} style={styles.clearBtn} disabled={!hasHits(pattern)}>
          <Ionicons name="trash-outline" size={15} color={hasHits(pattern) ? palette.textDim : palette.border} />
          <Text style={styles.clearText}>{t('common.clear', { defaultValue: 'Törlés' })}</Text>
        </Pressable>
        <Pressable
          onPress={() => onBake(patternHits(pattern), bars)}
          disabled={busy || !hasHits(pattern)}
          style={[styles.bakeBtn, (busy || !hasHits(pattern)) && styles.disabled]}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
          <Text style={styles.bakeText}>{t('studio.pianoRoll.bake', { defaultValue: 'Sávra' })}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{STEPS_PER_BAR}{t('studio.drums.stepHint', { defaultValue: '-od lépések · a félkövér vonalak a beatek' })}</Text>
    </AudioSheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 12, maxHeight: '86%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  stepBtn: { padding: 5, borderWidth: 1, borderColor: palette.border, borderRadius: 8 },
  barsText: { color: palette.text, fontSize: 13, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  info: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rowLabel: { width: 52 },
  rowLabelText: { color: palette.text, fontSize: 12, fontWeight: '700' },
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
  hint: { color: palette.textDim, fontSize: 11, paddingBottom: 6 },
});
