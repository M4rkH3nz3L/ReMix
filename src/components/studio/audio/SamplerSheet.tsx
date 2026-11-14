import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PreviewPlayButton } from '@/components/studio/audio/PreviewPlayButton';
import { decodeSample } from '@/lib/instrumentClient';
import { playPcm } from '@/lib/instrumentPreview';
import { renderSamplerPcm } from '@/lib/instrumentRender';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { palette } from '@/constants/editor';
import { audioIntakeText } from '@/lib/audioIntake';
import { registerDevAction } from '@/lib/devActions';
import { pickAudio } from '@/lib/media';
import {
  activeSteps,
  emptySampler,
  resizeSampler,
  samplerDurationSec,
  samplerHasHits,
  toggleSamplerStep,
  type SamplerPattern,
} from '@/lib/sampler';
import type { InstrumentDoc } from '@/types/project';
import { Chip } from '@/components/ui/controls';
import { DEFAULT_ROOT_MIDI, detectSlices, emptyPads, midiName, PAD_COUNT, renderPadsPcm, resizePads } from '@/lib/samplerPlus';

type SamplerMode = 'steps' | 'pads' | 'melody';

/** lépés-cella: 44 pt magas (Apple HIG érintési minimum) */
const CELL_W = 30;
const CELL_H = 44;

/**
 * 🎛️🔊 SAMPLER (AUDIOT §5): a felhasználó SAJÁT mintáját (one-shot) egy step-rácsra helyezi.
 * Minta kiválasztása → koppintás a lépésekre → „Sávra" (a telefonon sütve → klip). A lépés-logika
 * a pure `sampler.ts`-ben; a hang a feltöltött fájl (nem generált).
 * 🎛️ S1: `initial` = a klip mentett mintája („Minta szerkesztése”): a fájl és a rács abból jön,
 * a „Sávra” ugyanazt a klipet süti újra.
 */
export function SamplerSheet({
  bpm,
  busy,
  initial = null,
  onClose,
  onBake,
  onBakePads,
  onMelody,
}: {
  bpm: number;
  busy: boolean;
  initial?: InstrumentDoc | null;
  onClose: () => void;
  onBake: (sampleUri: string, pattern: SamplerPattern, bars: number, sampleName?: string) => void;
  /** 🎛️ V2.3 Pad mód: a szeletek a 4 pad lépés-során */
  onBakePads?: (sampleUri: string, slices: number[], pads: boolean[][], bars: number, sampleName?: string) => void;
  /** 🎛️ V2.3 Dallam mód: a piano roll nyílik a mintával (alaphang) */
  onMelody?: (sampleUri: string, sampleName: string, rootMidi: number) => void;
}) {
  const { t } = useTranslation();
  // 🎛️ V2.3: három mód — lépések (one-shot), padek (szeletek), dallam (kromatikus)
  const [mode, setMode] = useState<SamplerMode>(() => (initial?.sampler?.notes ? 'melody' : initial?.sampler?.pads ? 'pads' : 'steps'));
  const [slices, setSlices] = useState<number[]>(() => initial?.sampler?.slices?.slice() ?? []);
  const [pads, setPads] = useState<boolean[][]>(() => initial?.sampler?.pads?.map((r) => [...r]) ?? emptyPads(initial?.bars ?? 1));
  const [rootMidi, setRootMidi] = useState<number>(() => initial?.sampler?.rootMidi ?? DEFAULT_ROOT_MIDI);
  const [slicing, setSlicing] = useState(false);
  const [bars, setBars] = useState(() => initial?.bars ?? 1);
  const [pattern, setPattern] = useState<SamplerPattern>(() => initial?.sampler?.pattern.slice() ?? emptySampler(1));
  const [sampleUri, setSampleUri] = useState<string | null>(() => initial?.sampler?.sampleUri ?? null);
  const [sampleName, setSampleName] = useState<string>(() => initial?.sampler?.sampleName ?? '');
  const [picking, setPicking] = useState(false);

  // 🧪 füstteszt (S1): minta + rács beállítása, sütés, állapot kiolvasása
  const stateRef = useRef(() => `${bars}|${sampleName}|${activeSteps(pattern).join(',')}`);
  stateRef.current = () => `${bars}|${sampleName}|${activeSteps(pattern).join(',')}`;
  const bakeRef = useRef(() => sampleUri && onBake(sampleUri, pattern, bars, sampleName));
  bakeRef.current = () => sampleUri && onBake(sampleUri, pattern, bars, sampleName);
  useEffect(
    () =>
      registerDevAction('sampler.set', (arg) => {
        const a = arg as { sampleUri?: string; sampleName?: string; pattern?: SamplerPattern; bars?: number };
        if (a.bars) setBars(a.bars);
        if (a.pattern) setPattern(a.pattern);
        if (a.sampleUri) setSampleUri(a.sampleUri);
        if (a.sampleName !== undefined) setSampleName(a.sampleName);
        return true;
      }),
    []
  );
  useEffect(() => registerDevAction('sampler.bake', () => bakeRef.current()), []);
  useEffect(() => registerDevAction('sampler.state', () => stateRef.current()), []);

  const slice = async () => {
    if (!sampleUri || slicing) return [];
    setSlicing(true);
    try {
      const sample = await decodeSample(sampleUri);
      const found = sample ? detectSlices(sample, PAD_COUNT) : [];
      setSlices(found);
      return found;
    } finally {
      setSlicing(false);
    }
  };
  const playSlice = async (k: number) => {
    const sample = sampleUri ? await decodeSample(sampleUri) : null;
    const from = slices[k];
    if (!sample || from === undefined) return;
    const to = slices[k + 1] ?? sample[0].length;
    playPcm(sample.map((ch) => ch.subarray(from, to)));
  };
  // 🧪 füstteszt (V2.3): mód, szeletelés, padek, alaphang, sütés
  const sliceRef = useRef(slice);
  sliceRef.current = slice;
  const padBakeRef = useRef<() => void>(() => {});
  padBakeRef.current = () => {
    if (sampleUri) onBakePads?.(sampleUri, slices, pads, bars, sampleName);
  };
  const melodyRef = useRef<() => void>(() => {});
  melodyRef.current = () => {
    if (sampleUri) onMelody?.(sampleUri, sampleName, rootMidi);
  };
  useEffect(() => {
    const offs = [
      registerDevAction('sampler.mode', (m) => {
        setMode(m as SamplerMode);
        return true;
      }),
      registerDevAction('sampler.slice', () => sliceRef.current()),
      registerDevAction('sampler.setPads', (p) => {
        setPads(p as boolean[][]);
        return true;
      }),
      registerDevAction('sampler.root', (m) => {
        setRootMidi(Number(m));
        return true;
      }),
      registerDevAction('sampler.bakePads', () => padBakeRef.current()),
      registerDevAction('sampler.melody', () => melodyRef.current()),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const cols = pattern.map((_, i) => i);
  const durSec = samplerDurationSec(bars, bpm);

  const setBarsAndResize = (next: number) => {
    const b = Math.max(1, Math.min(4, next));
    setBars(b);
    setPattern((p) => resizeSampler(p, b));
    setPads((p) => resizePads(p, b));
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
          Alert.alert(t('studio.audio.intake.unreadableTitle'), audioIntakeText(picked.intake, t));
          return;
        }
        setSampleUri(picked.uri);
        setSampleName(picked.name);
        setSlices([]);
      }
    } finally {
      setPicking(false);
    }
  };

  const padsHit = pads.some((r) => r.some(Boolean));
  const canBake = !!sampleUri && (mode === 'pads' ? padsHit && slices.length > 0 : samplerHasHits(pattern));

  return (
    <AudioSheetFrame id="sampler" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="color-filter" size={16} color={palette.accent} /> {t('studio.sampler.title', { defaultValue: 'Sampler' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={24} color={palette.textDim} />
        </Pressable>
      </View>

      {/* minta-választó */}
      <Pressable style={styles.pickRow} onPress={pick} disabled={picking} accessibilityRole="button">
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

      {/* 🎛️ V2.3: mód */}
      <View style={styles.modes}>
        {(['steps', 'pads', 'melody'] as const).map((m) => (
          <Chip key={m} label={t(`studio.sampler.mode.${m}`)} active={mode === m} onPress={() => setMode(m)} />
        ))}
      </View>

      {mode === 'melody' ? (
        <View style={styles.melody}>
          <Text style={styles.info}>{t('studio.sampler.rootHint')}</Text>
          <View style={styles.controls}>
            <Pressable onPress={() => setRootMidi((m) => Math.max(24, m - 1))} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.sampler.rootDown')}>
              <Ionicons name="remove" size={16} color={palette.text} />
            </Pressable>
            <Text style={styles.barsText}>{t('studio.sampler.root', { note: midiName(rootMidi) })}</Text>
            <Pressable onPress={() => setRootMidi((m) => Math.min(96, m + 1))} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.sampler.rootUp')}>
              <Ionicons name="add" size={16} color={palette.text} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              if (sampleUri) onMelody?.(sampleUri, sampleName, rootMidi);
            }}
            disabled={!sampleUri || !onMelody}
            style={[styles.bakeBtn, (!sampleUri || !onMelody) && styles.disabled]}
            testID="sampler-melody"
            accessibilityRole="button"
          >
            <Ionicons name="musical-notes-outline" size={16} color="#fff" />
            <Text style={styles.bakeText}>{t('studio.sampler.openMelody')}</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'melody' ? null : (
      <>
      {/* vezérlők */}
      <View style={styles.controls}>
        <Pressable onPress={() => setBarsAndResize(bars - 1)} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.fewerBars')}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText}>{bars} {t('studio.pianoRoll.bars', { defaultValue: 'ütem' })}</Text>
        <Pressable onPress={() => setBarsAndResize(bars + 1)} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.moreBars')}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={styles.info}>{bpm} BPM · {durSec.toFixed(1)}s</Text>
      </View>

      {mode === 'pads' ? (
        <>
          <Pressable onPress={() => void slice()} disabled={!sampleUri || slicing} style={[styles.pickRow, !sampleUri && styles.disabled]} accessibilityRole="button" testID="sampler-slice">
            {slicing ? <ActivityIndicator size="small" color={palette.accent} /> : <Ionicons name="cut-outline" size={18} color={palette.accent} />}
            <Text style={styles.pickText}>{slices.length > 0 ? t('studio.sampler.slicesFound', { count: slices.length }) : t('studio.sampler.slice')}</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {pads.map((row, k) => (
                <View key={k} style={styles.row}>
                  <Pressable
                    onPress={() => void playSlice(k)}
                    disabled={slices[k] === undefined}
                    style={[styles.padLabel, slices[k] === undefined && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel={t('studio.sampler.padPlay', { n: k + 1 })}
                  >
                    <Text style={styles.padLabelText}>{k + 1}</Text>
                  </Pressable>
                  {row.map((on, step) => {
                    const beatStart = step % 4 === 0;
                    return (
                      <Pressable
                        key={step}
                        disabled={slices[k] === undefined}
                        onPress={() => {
                          if (!on) void playSlice(k);
                          setPads((p) => p.map((r, i) => (i === k ? r.map((x, j) => (j === step ? !x : x)) : r)));
                        }}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: !!on }}
                        accessibilityLabel={t('studio.sampler.padStep', { n: k + 1, step: step + 1 })}
                        style={[styles.cell, beatStart && styles.cellBeat, beatStart && step > 0 && styles.cellGroupGap, on && styles.cellOn, slices[k] === undefined && styles.disabled]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      ) : (
      <>
      {/* egysoros step-rács */}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.row}>
          {cols.map((step) => {
            const on = pattern[step];
            const beatStart = step % 4 === 0;
            return (
              <Pressable
                key={step}
                onPress={() => {
                  // 🎧 az új lépés: a minta azonnal megszólal
                  if (!on && sampleUri) void decodeSample(sampleUri).then((x) => x && playPcm(x));
                  setPattern((p) => toggleSamplerStep(p, step));
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: !!on }}
                accessibilityLabel={t('studio.audio.a11y.step', { step: step + 1 })}
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
      </>
      )}

      <View style={styles.footer}>
        <PreviewPlayButton
          testID="sampler-play"
          disabled={!canBake}
          version={`${mode}|${bpm}|${bars}|${sampleUri}|${activeSteps(pattern).join(',')}|${slices.join(',')}|${pads.map((r) => activeSteps(r).join('.')).join('/')}`}
          build={async () => {
            const sample = sampleUri ? await decodeSample(sampleUri) : null;
            if (!sample) return null;
            if (mode === 'pads') return padsHit && slices.length > 0 ? renderPadsPcm(sample, slices, pads, bars, bpm) : null;
            return samplerHasHits(pattern) ? renderSamplerPcm(sample, activeSteps(pattern), bars, bpm) : null;
          }}
        />
        <Pressable
          onPress={() => (mode === 'pads' ? setPads(emptyPads(bars)) : setPattern(emptySampler(bars)))}
          style={styles.clearBtn}
          disabled={mode === 'pads' ? !padsHit : !samplerHasHits(pattern)}
        >
          <Ionicons name="trash-outline" size={15} color={(mode === 'pads' ? padsHit : samplerHasHits(pattern)) ? palette.textDim : palette.border} />
          <Text style={styles.clearText}>{t('common.clear', { defaultValue: 'Törlés' })}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!sampleUri) return;
            if (mode === 'pads') onBakePads?.(sampleUri, slices, pads, bars, sampleName);
            else onBake(sampleUri, pattern, bars, sampleName);
          }}
          disabled={busy || !canBake}
          style={[styles.bakeBtn, (busy || !canBake) && styles.disabled]}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
          <Text style={styles.bakeText}>{t('studio.pianoRoll.bake', { defaultValue: 'Sávra' })}</Text>
        </Pressable>
      </View>
      </>
      )}
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
  modes: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  melody: { gap: 10, marginBottom: 12 },
  padLabel: { width: 30, height: CELL_H, marginRight: 6, borderRadius: 8, backgroundColor: palette.accent2, alignItems: 'center', justifyContent: 'center' },
  padLabelText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
