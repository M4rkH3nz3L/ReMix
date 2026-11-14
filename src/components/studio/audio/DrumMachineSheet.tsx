import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UserPresetRow } from '@/components/studio/audio/UserPresetRow';
import { PreviewPlayButton } from '@/components/studio/audio/PreviewPlayButton';
import { registerDevAction } from '@/lib/devActions';
import { auditionDrum } from '@/lib/instrumentPreview';
import { renderDrumsPcm } from '@/lib/instrumentRender';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import type { InstrumentDoc } from '@/types/project';
import { palette } from '@/constants/editor';
import {
  cycleVelocity,
  DRUM_ACCENT,
  DRUM_KITS,
  DRUM_LABEL,
  DRUM_SOFT,
  DRUM_VOICES,
  drumKit,
  emptyPattern,
  hasHits,
  normalizePattern,
  type DrumKitId,
  patternDurationSec,
  patternHits,
  resizeVelocity,
  STEPS_PER_BAR,
  SWING_MAX,
  stepCount,
  toggleStep,
  type DrumHit,
  type DrumPattern,
  type DrumVelocity,
} from '@/lib/drums';

/** a dobgép szerkeszthető állapota (a hangszer-minta forrása) */
export interface DrumSource {
  pattern: DrumPattern;
  velocity: DrumVelocity;
  swing: number;
}

/** lépés-cella: 44 pt magas (Apple HIG érintési minimum) — a workspace-ben van rá hely */
const CELL_W = 30;
const CELL_H = 44;

/**
 * 🥁 DOB-GÉP (AUDIOT §5): step-sequencer rács (hangok × 16-od lépések). Koppintás = ütés be/ki,
 * hosszan nyomva az ütés szintje (normál → hangsúlyos → halk); a swing a páros 16-odokat késlelteti.
 * A „Sávra" a worker `/drums`-án szintetizált dob-mintává rendereli (nincs minta-fájl-függés),
 * és a Hang Stúdió sima klipként teszi a sávra. A lépés-logika a pure `drums.ts`-ben.
 */
export function DrumMachineSheet({
  bpm,
  busy,
  onClose,
  onBake,
  initial = null,
}: {
  bpm: number;
  busy: boolean;
  onClose: () => void;
  onBake: (hits: DrumHit[], bars: number, src: DrumSource) => void;
  /** 🥁 a szerkesztett hangszer-minta (újraszerkesztés); null = új minta */
  initial?: InstrumentDoc | null;
}) {
  const { t } = useTranslation();
  const [bars, setBars] = useState(() => initial?.bars ?? 1);
  // 🥁 S12: a régi (4 soros) mentett minta a 8 hangra kiegészítve
  const [pattern, setPattern] = useState<DrumPattern>(() => (initial?.drums?.pattern ? normalizePattern(initial.drums.pattern, initial.bars ?? 1) : emptyPattern(1)));
  const [velocity, setVelocity] = useState<DrumVelocity>(() => initial?.drums?.velocity ?? {});
  /** 0–0,6 (a lépés-hossz aránya) */
  const [swing, setSwing] = useState(() => initial?.drums?.swing ?? 0);
  const hitsOf = () => patternHits(pattern, velocity, swing);
  // 🧪 füstteszt: egy alap ütem (kick 1/3, snare 2/4, hihat nyolcadok)
  useEffect(
    () =>
      registerDevAction('drums.demo', () => {
        let p = emptyPattern(1);
        for (const s of [0, 8]) p = toggleStep(p, 'kick', s);
        for (const s of [4, 12]) p = toggleStep(p, 'snare', s);
        for (let s = 0; s < 16; s += 2) p = toggleStep(p, 'hihat', s);
        setPattern(p);
        return patternHits(p).length;
      }),
    []
  );
  // 🧪 füstteszt (R7): minta + ütésenkénti szint + swing beállítása
  useEffect(
    () =>
      registerDevAction('drums.set', (arg) => {
        const a = arg as { pattern: DrumPattern; velocity?: DrumVelocity; swing?: number; bars?: number };
        setBars(a.bars ?? 1);
        setPattern(a.pattern);
        setVelocity(a.velocity ?? {});
        setSwing(a.swing ?? 0);
        return true;
      }),
    []
  );
  const hitsRef = useRef(hitsOf);
  hitsRef.current = hitsOf;
  const bakeRef = useRef(() => onBake(hitsOf(), bars, { pattern, velocity, swing }));
  bakeRef.current = () => onBake(hitsOf(), bars, { pattern, velocity, swing });
  useEffect(() => registerDevAction('drums.bake', () => bakeRef.current()), []);
  // 🥁 S12: beépített készlet (a rács felülíródik; a sütött klip visszavonható)
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const applyKit = (kit: DrumKitId) => {
    const k = drumKit(kit, barsRef.current);
    setPattern(k.pattern);
    setVelocity(k.velocity);
    setSwing(k.swing);
  };
  const applyKitRef = useRef(applyKit);
  applyKitRef.current = applyKit;
  useEffect(
    () =>
      registerDevAction('drums.kit', (arg) => {
        applyKitRef.current(arg as DrumKitId);
        return true;
      }),
    []
  );
  useEffect(() => registerDevAction('drums.hits', () => hitsRef.current().map((h) => `${h.voice}${h.step}${h.velocity ? `v${h.velocity}` : ''}`).join(',')), []);

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
    setVelocity((prev) => resizeVelocity(prev, b));
  };
  const setSwingStep = (delta: number) => setSwing((s) => Math.round(Math.max(0, Math.min(SWING_MAX, s + delta)) * 10) / 10);

  return (
    <AudioSheetFrame id="drumMachine" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="grid" size={16} color={palette.accent} /> {t('studio.drums.title', { defaultValue: 'Dob-gép' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={24} color={palette.textDim} />
        </Pressable>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => setBarsAndResize(bars - 1)} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.fewerBars')}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText}>{bars} {t('studio.pianoRoll.bars', { defaultValue: 'ütem' })}</Text>
        <Pressable onPress={() => setBarsAndResize(bars + 1)} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.moreBars')}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {/* swing: 0–60 %, 10-esével */}
        <Text style={styles.info}>{t('studio.drums.swing', { defaultValue: 'Swing' })}</Text>
        <Pressable testID="drums-swing-minus" onPress={() => setSwingStep(-0.1)} disabled={swing <= 0} hitSlop={6} style={[styles.stepBtn, swing <= 0 && styles.disabled]} accessibilityLabel={t('studio.drums.swingLess', { defaultValue: 'Kevesebb swing' })}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText} testID="drums-swing-value">{Math.round(swing * 100)} %</Text>
        <Pressable testID="drums-swing-plus" onPress={() => setSwingStep(0.1)} disabled={swing >= SWING_MAX} hitSlop={6} style={[styles.stepBtn, swing >= SWING_MAX && styles.disabled]} accessibilityLabel={t('studio.drums.swingMore', { defaultValue: 'Több swing' })}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.info}>{bpm} BPM · {durSec.toFixed(1)}s</Text>
      </View>

      {/* ⭐ saját dobminták */}
      <UserPresetRow
        kind="drums"
        getValue={() => (hasHits(pattern) ? { bars, pattern, velocity, swing } : null)}
        onApply={(v) => {
          setBars(v.bars);
          setPattern(v.pattern);
          setVelocity(v.velocity ?? {});
          setSwing(v.swing ?? 0);
        }}
      />

      {/* 🥁 beépített minta-készletek: gyors kezdés (Alap · House · Hip-hop) */}
      <View style={styles.controls}>
        <Text style={styles.info}>{t('studio.drums.kit')}</Text>
        {DRUM_KITS.map((kit) => (
          <Pressable key={kit} testID={`drums-kit-${kit}`} onPress={() => applyKit(kit)} style={styles.kitBtn} accessibilityRole="button" accessibilityLabel={`${t('studio.drums.kit')}: ${t(`studio.drums.kit_${kit}`)}`} accessibilityHint={t('studio.drums.kitHint')}>
            <Text style={styles.kitText}>{t(`studio.drums.kit_${kit}`)}</Text>
          </Pressable>
        ))}
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
                const vel = velocity[voice]?.[step];
                const beatStart = step % 4 === 0;
                return (
                  <Pressable
                    key={step}
                    testID={`drums-cell-${voice}-${step}`}
                    onPress={() => {
                      // 🎧 az új ütés azonnal megszólal
                      if (!on) void auditionDrum(voice, vel);
                      setPattern((p) => toggleStep(p, voice, step));
                    }}
                    onLongPress={() => {
                      // hosszan: az ütés szintje (normál → hangsúlyos → halk); üres cellán be is kapcsol
                      const next = cycleVelocity(velocity, voice, step);
                      setVelocity(next);
                      if (!on) setPattern((p) => toggleStep(p, voice, step));
                      void auditionDrum(voice, next[voice]?.[step]);
                    }}
                    accessibilityLabel={`${DRUM_LABEL[voice]} ${step + 1}`}
                    accessibilityState={{ selected: !!on }}
                    accessibilityHint={t('studio.drums.velHint', { defaultValue: 'Hosszan nyomva: normál, hangsúlyos vagy halk ütés' })}
                    style={[
                      styles.cell,
                      beatStart && styles.cellBeat,
                      // ütemcsoport-térköz (4-esével) — a rács ránézésre olvasható, mint egy hardveres dobgépen
                      beatStart && step > 0 && styles.cellGroupGap,
                      on && styles.cellOn,
                      on && vel === DRUM_ACCENT && styles.cellAccent,
                      on && vel === DRUM_SOFT && styles.cellSoft,
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PreviewPlayButton
          testID="drums-play"
          disabled={!hasHits(pattern)}
          version={`${bpm}|${bars}|${hitsOf().map((h) => `${h.voice}${h.step}v${h.velocity ?? ''}`).join(',')}`}
          build={() => (hasHits(pattern) ? renderDrumsPcm(hitsOf(), bars, bpm) : null)}
        />
        <Pressable
          onPress={() => {
            setPattern(emptyPattern(bars));
            setVelocity({});
          }} style={styles.clearBtn} disabled={!hasHits(pattern)}>
          <Ionicons name="trash-outline" size={15} color={hasHits(pattern) ? palette.textDim : palette.border} />
          <Text style={styles.clearText}>{t('common.clear', { defaultValue: 'Törlés' })}</Text>
        </Pressable>
        <Pressable
          onPress={() => onBake(hitsOf(), bars, { pattern, velocity, swing })}
          disabled={busy || !hasHits(pattern)}
          style={[styles.bakeBtn, (busy || !hasHits(pattern)) && styles.disabled]}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
          <Text style={styles.bakeText}>{t('studio.pianoRoll.bake', { defaultValue: 'Sávra' })}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{STEPS_PER_BAR}{t('studio.drums.stepHint', { defaultValue: '-od lépések · a félkövér vonalak a beatek · hosszan nyomva: hangsúlyos / halk' })}</Text>
    </AudioSheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 12, maxHeight: '86%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  stepBtn: { padding: 5, borderWidth: 1, borderColor: palette.border, borderRadius: 8 },
  barsText: { color: palette.text, fontSize: 13, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  info: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  kitBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceHigh },
  kitText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rowLabel: { width: 52 },
  rowLabelText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  cell: { width: CELL_W, height: CELL_H, marginRight: 3, borderRadius: 4, borderWidth: 1, borderColor: `${palette.border}99`, backgroundColor: '#0b0d14' },
  cellBeat: { borderColor: palette.border, backgroundColor: '#11131c' },
  cellOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  cellGroupGap: { marginLeft: 6 },
  cellAccent: { borderColor: '#fff', borderWidth: 2 },
  cellSoft: { opacity: 0.45 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  clearText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  bakeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.accent, borderRadius: 10, paddingVertical: 11 },
  bakeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  hint: { color: palette.textDim, fontSize: 11, paddingBottom: 6 },
});
