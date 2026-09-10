import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette, speedPresets } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { setChannelKeyframe } from '@/lib/keyframes';
import { maxVideoDuration } from '@/lib/projectUtils';
import { CurveEditor } from '@/components/editor/CurveEditor';
import { SPEED_RAMP_PRESETS, buildSpeedRampPlan } from '@/lib/speedRamp';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

export function SpeedPanel({ clip }: { clip: VideoClip }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  // 🌀 mozgás-elmosás erő a rampnál (0 = ki); a darabok ezt öröklik
  const [rampBlur, setRampBlur] = useState(0.6);
  // 🚀 egyéni görbe: null = preset-mód, tömb = a szerkesztőben állított görbe
  const [customCurve, setCustomCurve] = useState<number[] | null>(null);

  // 🚀 speed ramp: preset VAGY egyéni görbe → lépcsős sebességű darabok,
  // egy undo-lépésben
  const applyRamp = (
    source: (typeof SPEED_RAMP_PRESETS)[number] | { label: string; curve: number[] }
  ) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const plan = buildSpeedRampPlan(
      state.project,
      clip.id,
      'id' in source ? source.id : source.curve,
      () => makeId('clip'),
      rampBlur
    );
    if (!plan) {
      Alert.alert('Speed ramp', 'Ehhez a kliphez nem alkalmazható (túl rövid?).');
      return;
    }
    const kfWarning = clip.keyframes
      ? '\n\nA klip kulcskockás mozgása a ramppal lekerül.'
      : '';
    Alert.alert(
      `Speed ramp — ${source.label}`,
      `A klip ${plan.pieces} változó sebességű darabra oszlik; a hossza és a ` +
        `többi sáv időzítése nem változik. A művelet visszavonható.` +
        (rampBlur > 0
          ? '\n\nMozgás-elmosás bekapcsolva: a gyors darabok elmosódnak, a ' +
            'lassúak interpolált köztes kockákat kapnak (csak a renderben).'
          : '') +
        kfWarning,
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Alkalmazás',
          onPress: () => {
            state.dispatch(
              { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
              'user'
            );
          },
        },
      ]
    );
  };

  const setSpeed = (speed: number) => {
    const next = clamp(speed, 0.1, 10);
    // a sebesség változásával a klip idővonal-hossza is változik
    const scaled = { ...clip, speed: next };
    const duration = Math.min(
      (clip.duration * clip.speed) / next,
      maxVideoDuration(scaled)
    );
    updateClip(clip.id, { speed: next, duration });
  };

  return (
    <View>
      <PanelSection title="Sebesség">
        <View style={styles.row}>
          {speedPresets.map((preset) => (
            <Chip
              key={preset}
              label={`${preset}×`}
              active={clip.speed === preset}
              onPress={() => setSpeed(preset)}
            />
          ))}
        </View>
        <Stepper
          label="Finomhangolás"
          value={`${clip.speed.toFixed(2)}×`}
          onDec={() => setSpeed(Math.round((clip.speed - 0.1) * 100) / 100)}
          onInc={() => setSpeed(Math.round((clip.speed + 0.1) * 100) / 100)}
        />
      </PanelSection>

      <PanelSection title="🚀 Speed ramp">
        <View style={styles.row}>
          {SPEED_RAMP_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={preset.label}
              active={false}
              onPress={() => applyRamp(preset)}
            />
          ))}
        </View>
        <Text style={styles.subLabel}>Egyéni görbe</Text>
        <View style={styles.row}>
          <Chip
            label={customCurve ? '✎ Szerkesztő be' : '✎ Saját görbe rajzolása'}
            active={Boolean(customCurve)}
            onPress={() =>
              setCustomCurve(customCurve ? null : [1.6, 1.2, 0.5, 0.5, 1.2, 1.6])
            }
          />
        </View>
        {customCurve ? (
          <>
            <CurveEditor curve={customCurve} onChange={setCustomCurve} />
            <Chip
              label="Egyéni görbe alkalmazása"
              active={false}
              onPress={() => applyRamp({ label: 'egyéni görbe', curve: customCurve })}
            />
            <Text style={styles.note}>
              Húzd az oszlopokat: minden oszlop egy egyenlő forrás-szakasz
              sebessége. A skála logaritmikus, a vonal az 1× — fölötte
              gyorsítás, alatta lassítás. A klip idővonal-hossza akkor sem
              változik, ha a görbét átrajzolod.
            </Text>
          </>
        ) : null}

        <Text style={styles.subLabel}>🌀 Mozgás-elmosás</Text>
        <View style={styles.row}>
          {[
            { v: 0, label: 'Ki' },
            { v: 0.35, label: 'Finom' },
            { v: 0.6, label: 'Közepes' },
            { v: 1, label: 'Erős' },
          ].map((opt) => (
            <Chip
              key={opt.label}
              label={opt.label}
              active={rampBlur === opt.v}
              onPress={() => setRampBlur(opt.v)}
            />
          ))}
        </View>
        <Text style={styles.note}>
          A sebesség a klipen belül változik a görbe szerint (pl. Hero: lassítás
          a közepén) — a klip hossza nem változik, és a darabok utána egyenként
          is finomhangolhatók. Előnézetben és renderben is él; a mozgás-elmosás
          csak az exportált videóban látszik.
        </Text>
      </PanelSection>

      <PanelSection title="🌀 Mozgás-elmosás (ezen a klipen)">
        <View style={styles.row}>
          {[
            { v: 0, label: 'Ki' },
            { v: 0.35, label: 'Finom' },
            { v: 0.6, label: 'Közepes' },
            { v: 1, label: 'Erős' },
          ].map((opt) => (
            <Chip
              key={opt.label}
              label={opt.label}
              active={(clip.motionBlur ?? 0) === opt.v}
              onPress={() => updateClip(clip.id, { motionBlur: opt.v || undefined })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          {clip.speed > 1.05
            ? 'Gyorsításnál a kihagyott képkockákat mossa össze — a mozgás folyamatos lesz, nem darabos.'
            : clip.speed < 0.95
              ? 'Lassításnál köztes képkockákat számol (mozgás-interpoláció), így a lassítás sima marad. Lassabb render.'
              : 'Akkor hat, ha a klip gyorsítva vagy lassítva van.'}
        </Text>
      </PanelSection>

      <PanelSection title="Hangerő">
        <Stepper
          label="Klip hangja"
          value={`${Math.round(clip.volume * 100)}%`}
          onDec={() => updateClip(clip.id, { volume: clamp(clip.volume - 0.1, 0, 1) })}
          onInc={() => updateClip(clip.id, { volume: clamp(clip.volume + 0.1, 0, 1) })}
        />
        {clip.volume > 0 ? (
          <View style={styles.row}>
            <Chip
              label="✨ Enhance Voice"
              active={clip.voiceEnhance === true}
              onPress={() => updateClip(clip.id, { voiceEnhance: !clip.voiceEnhance })}
            />
            <Chip
              label="🔇 Visszhang le"
              active={clip.deReverb === true}
              onPress={() => updateClip(clip.id, { deReverb: !clip.deReverb })}
            />
          </View>
        ) : null}
        <View style={styles.row}>
          <Chip
            label="◆ Hangerő-kulcskocka (playhead)"
            active={false}
            onPress={() => {
              const state = useEditorStore.getState();
              const t = clamp(state.playhead - clip.start, 0, clip.duration);
              const k = clip.keyframes ?? {};
              updateClip(clip.id, {
                keyframes: {
                  ...k,
                  volume: setChannelKeyframe(k.volume, t, clip.volume, 'linear'),
                },
              });
            }}
          />
          {clip.keyframes?.volume?.length ? (
            <Chip
              label={`Automáció törlése (${clip.keyframes.volume.length})`}
              active={false}
              onPress={() =>
                updateClip(clip.id, {
                  keyframes: { ...clip.keyframes, volume: undefined },
                })
              }
            />
          ) : null}
        </View>
        {clip.voiceEnhance || clip.deReverb ? (
          <Text style={styles.note}>
            🎙️ A javított hang az ELŐNÉZETBEN is hallható (a worker ugyanazzal a
            lánccal dolgozza fel, mint a render). Az első lejátszáskor pár
            másodpercig még a nyers hang szól, amíg elkészül.
          </Text>
        ) : null}
        <Text style={styles.note}>
          Hangerő-automáció: állítsd a hangerőt, állj a playheaddel a kívánt
          pontra, és üsd le a ◆-t — a hangerő a kulcskockák közt átúszik.
        </Text>
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
