import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { clipEditStyles as styles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { beatLabel } from '@/lib/clipEditOps';
import { DELAY_BEAT_OPTIONS, delayMsForBeats, EQ_BAND_SPEC, EQ_Q_MAX, EQ_Q_MIN, type eqBandParams, type EqBandKey } from '@/lib/fxParams';
import type { AudioFx } from '@/types/project';

type Eq = NonNullable<AudioFx['eq']>;

/** 🎛️ a klip-effektek szabályzói: hangmagasság, harmónia, szűrők, EQ (parametrikus is), dinamika, zengés, delay */
export function FxParamsSection({
  fx,
  patchFx,
  eq,
  setEq,
  paramEq,
  setParamEq,
  bands,
  bpmHere,
}: {
  fx: AudioFx;
  patchFx: (p: Partial<AudioFx>) => void;
  eq: Eq;
  setEq: (p: Partial<Eq>) => void;
  paramEq: boolean;
  setParamEq: (v: boolean) => void;
  bands: ReturnType<typeof eqBandParams>;
  bpmHere: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎚️ hangmagasság-eltolás (transzponálás, hossz-tartó) — −12…+12 félhang */}
      <Slider
        label={t('studio.audio.fxPitch', { defaultValue: 'Hangmagasság (félhang)' })}
        value={fx.pitchSemitones ?? 0}
        min={-12}
        max={12}
        onChange={(v) => patchFx({ pitchSemitones: Math.round(v) })}
        format={(v) => (Math.round(v) === 0 ? t('common.off') : `${v > 0 ? '+' : ''}${Math.round(v)}`)}
      />
      {/* 🗣️ V7.3: a hangszín (formánsok) megtartása a tolásnál — nincs „mókus/óriás" hatás */}
      {(fx.pitchSemitones ?? 0) !== 0 || (fx.harmony ?? 0) !== 0 ? (
        <ToggleRow icon="person-outline" label={t('studio.audio.fxParam.formant')} value={!!fx.formant} onValueChange={(v) => patchFx({ formant: v || undefined })} />
      ) : null}
      {/* 🎵 harmónia-hang: eltolt másodhang a klip mellé (pl. +7 kvint, +4 terc) */}
      <Slider
        label={t('studio.audio.fxHarmony', { defaultValue: 'Harmónia-hang (félhang)' })}
        value={fx.harmony ?? 0}
        min={-12}
        max={12}
        onChange={(v) => patchFx({ harmony: Math.round(v) })}
        format={(v) => (Math.round(v) === 0 ? t('common.off') : `${v > 0 ? '+' : ''}${Math.round(v)}`)}
      />
      {/* 🎚️ szűrők: aluláteresztő (dörej) + felüláteresztő (sziszegés) — 0 = ki */}
      <Slider
        label={t('panels.audio.fxHighpass')}
        value={fx.highpass ?? 0}
        min={0}
        max={300}
        onChange={(v) => patchFx({ highpass: v < 20 ? 0 : Math.round(v) })}
        format={(v) => (v < 20 ? t('common.off') : `${Math.round(v)} Hz`)}
      />
      <Slider
        label={t('panels.audio.fxLowpass')}
        value={fx.lowpass ?? 0}
        min={0}
        max={20000}
        onChange={(v) => patchFx({ lowpass: v < 1000 ? 0 : Math.round(v / 100) * 100 })}
        format={(v) => (v < 1000 ? t('common.off') : `${(v / 1000).toFixed(1)} kHz`)}
      />
      {/* 🎚️ 3-sávos EQ (−12…+12 dB) */}
      <Slider label={t('panels.audio.fxEqLow')} value={eq.low} min={-12} max={12} onChange={(v) => setEq({ low: Math.round(v) })} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} dB`} />
      <Slider label={t('panels.audio.fxEqMid')} value={eq.mid} min={-12} max={12} onChange={(v) => setEq({ mid: Math.round(v) })} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} dB`} />
      <Slider label={t('panels.audio.fxEqHigh')} value={eq.high} min={-12} max={12} onChange={(v) => setEq({ high: Math.round(v) })} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} dB`} />
      <ToggleRow icon="pulse-outline" label={t('studio.audio.fxParam.parametric')} value={paramEq} onValueChange={setParamEq} />
      {paramEq
        ? bands.map((b) => {
            const spec = EQ_BAND_SPEC[b.key as EqBandKey];
            const name = t(`panels.audio.fxEq${b.key === 'low' ? 'Low' : b.key === 'mid' ? 'Mid' : 'High'}`);
            return (
              <View key={b.key}>
                <Slider
                  label={t('studio.audio.fxParam.freq', { band: name })}
                  value={Math.log10(b.freq)}
                  min={Math.log10(spec.min)}
                  max={Math.log10(spec.max)}
                  onChange={(v) => setEq({ [`${b.key}Freq`]: Math.round(10 ** v) } as Partial<typeof eq>)}
                  format={(v) => (10 ** v >= 1000 ? `${(10 ** v / 1000).toFixed(1)} kHz` : `${Math.round(10 ** v)} Hz`)}
                />
                <Slider
                  label={t('studio.audio.fxParam.q', { band: name })}
                  value={b.q}
                  min={EQ_Q_MIN}
                  max={EQ_Q_MAX}
                  onChange={(v) => setEq({ [`${b.key}Q`]: Math.round(v * 10) / 10 } as Partial<typeof eq>)}
                  format={(v) => v.toFixed(1)}
                />
              </View>
            );
          })
        : null}

      <ToggleRow icon="remove-circle-outline" label={t('panels.audio.fxDenoise')} value={!!fx.denoise} onValueChange={(v) => patchFx({ denoise: v })} />
      <ToggleRow icon="power-outline" label={t('studio.audio.fxGate', { defaultValue: 'Zajkapu' })} value={!!fx.gate} onValueChange={(v) => patchFx({ gate: v })} />
      <ToggleRow icon="headset-outline" label={t('studio.audio.fxStereoWide', { defaultValue: 'Sztereó-szélesítés' })} value={!!fx.stereoWide} onValueChange={(v) => patchFx({ stereoWide: v })} />
      <ToggleRow icon="cut-outline" label={t('panels.audio.fxDeEsser')} value={!!fx.deEsser} onValueChange={(v) => patchFx({ deEsser: v })} />
      <ToggleRow icon="contract-outline" label={t('panels.audio.fxCompressor')} value={!!fx.compressor} onValueChange={(v) => patchFx({ compressor: v })} />
      <ToggleRow icon="alert-outline" label={t('panels.audio.fxLimiter')} value={!!fx.limiter} onValueChange={(v) => patchFx({ limiter: v })} />
      <ToggleRow icon="options-outline" label={t('panels.audio.fxNormalize')} value={!!fx.normalize} onValueChange={(v) => patchFx({ normalize: v })} />
      <Slider
        label={t('panels.audio.fxReverb')}
        value={fx.reverb ?? 0}
        min={0}
        max={1}
        onChange={(v) => patchFx({ reverb: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label={t('panels.audio.fxDelay')}
        value={fx.delay ?? 0}
        min={0}
        max={1}
        onChange={(v) => patchFx({ delay: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      {/* 🥁 V7: a delay ideje ütemre (a tempóból) vagy szabadon (a mértékből) */}
      <Text style={styles.autoLabel}>{t('studio.audio.fxParam.delaySync')}</Text>
      <View style={styles.autoChips}>
        {[0, ...DELAY_BEAT_OPTIONS].map((b) => {
          const active = (fx.delayBeats ?? 0) === b;
          const label = b === 0 ? t('studio.audio.fxParam.free') : beatLabel(b);
          return (
            <Pressable
              key={b}
              testID={`fx-delay-beats-${b}`}
              accessibilityRole="button"
              accessibilityLabel={t('studio.audio.fxParam.delaySyncA11y', { value: label })}
              accessibilityState={{ selected: active }}
              onPress={() => patchFx(b === 0 ? { delayBeats: undefined, delayMs: undefined } : { delayBeats: b, delayMs: delayMsForBeats(b, bpmHere) })}
              style={[styles.autoChip, active && styles.autoChipActive]}
            >
              <Text style={[styles.autoChipText, active && styles.autoChipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {fx.delayBeats ? <Text style={styles.hint}>{t('studio.audio.fxParam.syncHint', { ms: delayMsForBeats(fx.delayBeats, bpmHere), bpm: Math.round(bpmHere) })}</Text> : null}
      <Text style={styles.hint}>{t('panels.audio.mixHint')}</Text>
    </>
  );
}
