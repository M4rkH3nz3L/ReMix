import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { registerDevAction } from '@/lib/devActions';
import { UserPresetRow } from '@/components/studio/audio/UserPresetRow';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { startSilenceSearch } from '@/components/studio/audio/SilenceReview';
import { startSpeechEdit } from '@/components/studio/audio/SpeechEditBar';
import { startAudioSync } from '@/components/studio/audio/audioSyncAction';
import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { AUDIO_FX_PRESETS, presetFx } from '@/lib/audioFxPresets';
import { renderClipSpectrum } from '@/lib/audioSpectrum';
import { RegionBar, Slider, ToggleRow, useWaveform } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import type { EditorCommand } from '@/lib/commands';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { stemClipsFrom } from '@/lib/stemClips';
import { separateStems, STEM_SEPARATION_ENABLED } from '@/lib/stems';
import { selectTakeCommand } from '@/lib/punchRecord';
import { tempoMatchPatch, tempoResetPatch } from '@/lib/tempoMatch';
import { fxStageOrder, moveStage, type FxStage } from '@/lib/fxOrder';
import { CLIP_DB_MAX, CLIP_DB_MIN, CLIP_VOLUME_MAX, dbToVolume, formatDb, volumeToDb } from '@/lib/clipGain';
import { TakePicker } from '@/components/studio/audio/TakePicker';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { guardPro, usePaywall } from '@/store/paywallStore';
import { useEntitlement } from '@/store/entitlementStore';
import { withProgress } from '@/store/progressStore';
import type { AudioClip, AudioFx, Project } from '@/types/project';
import { audioFormatLabel } from '@/lib/audioFormat';

type FxAutoKey = 'fxLowpass' | 'fxHighpass' | 'fxReverb' | 'fxDelay' | 'fxEqLow' | 'fxEqMid' | 'fxEqHigh';

/** 🎛️ az automatizálható effekt-paraméterek: tartomány, alapérték (a statikus beállítás), kiírás */
const FX_AUTO: { key: FxAutoKey; min: number; max: number; fallback: (fx?: AudioFx) => number; format: (v: number) => string }[] = [
  { key: 'fxLowpass', min: 1000, max: 20000, fallback: (fx) => fx?.lowpass || 20000, format: (v) => `${(v / 1000).toFixed(1)} kHz` },
  { key: 'fxHighpass', min: 20, max: 2000, fallback: (fx) => fx?.highpass || 20, format: (v) => `${Math.round(v)} Hz` },
  { key: 'fxReverb', min: 0, max: 1, fallback: (fx) => fx?.reverb ?? 0, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'fxDelay', min: 0, max: 1, fallback: (fx) => fx?.delay ?? 0, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'fxEqLow', min: -12, max: 12, fallback: (fx) => fx?.eq?.low ?? 0, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'fxEqMid', min: -12, max: 12, fallback: (fx) => fx?.eq?.mid ?? 0, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'fxEqHigh', min: -12, max: 12, fallback: (fx) => fx?.eq?.high ?? 0, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` },
];

/**
 * 🎚️ Klip-szerkesztő lap — a kijelölt hangklip nem-destruktív szerkesztése
 * (trim / fade / hangerő / pan / enhance / Pro FX). Minden a `HangStudio`-ból
 * ismert mintát követi: a lap LOKÁLIS állapotban dolgozik, és a „Kész" EGY
 * `updateClip`-pel commitál → EGY undo-lépés. A vágás/keyframe frame-rácsra ül.
 */
export function ClipEditSheet({
  clip,
  fps,
  onClose,
  onEditInstrument,
}: {
  clip: AudioClip;
  fps: number;
  onClose: () => void;
  /** 🎹🥁 a sütött hangszer-klip mintájának újraszerkesztése (a dobgép / piano roll nyílik) */
  onEditInstrument?: (docId: string) => void;
}) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const applyBatch = useEditorStore((s) => s.applyBatch);
  const playhead = useEditorStore((s) => s.playhead);
  // 🎚️ S16: a forrás formátuma (az asseten, importkor kiolvasva)
  const asset = useEditorStore((s) => (clip.assetId ? s.project?.assets.find((a) => a.id === clip.assetId) : undefined));
  const formatText = asset ? audioFormatLabel(asset, { mono: t('studio.audio.format.mono'), stereo: t('studio.audio.format.stereo'), channels: (n) => t('studio.audio.format.channels', { count: n }) }) : '';
  const [separating, setSeparating] = useState(false);
  const [autoChannel, setAutoChannel] = useState<FxAutoKey>('fxLowpass');

  // 🎚️ AI stem-szeparáció (Pro): a klip hangját vocals/drums/bass/other klipekre
  // bontja (voiceover/sfx sávra), és az eredetit elnémítja — EGY undo.
  const onSeparate = () =>
    guardPro(
      () =>
        withProgress(t('studio.audio.stemsWorking'), () => {
          setSeparating(true);
          return separateStems(clip.uri).then((stems) => {
            const commands: EditorCommand[] = stemClipsFrom(clip, stems, () => makeId('clip')).map((stem) => ({
              type: 'ADD_CLIP',
              trackType: stem.trackType,
              clip: stem.clip,
            }));
            commands.push({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { volume: 0 } });
            applyBatch(commands, 'user');
            onClose();
          });
        }),
      (e) => Alert.alert(t('studio.audio.stems'), e.message)
    ).finally(() => setSeparating(false));

  const [volume, setVolume] = useState(clip.volume);
  const [fadeIn, setFadeIn] = useState(clip.fadeIn);
  const [fadeOut, setFadeOut] = useState(clip.fadeOut);
  const [duration, setDuration] = useState(clip.duration);
  const [trimIn, setTrimIn] = useState(clip.trimIn ?? 0);
  const [pan, setPan] = useState(clip.pan ?? 0);
  const [voiceEnhance, setVoiceEnhance] = useState(!!clip.voiceEnhance);
  const [deReverb, setDeReverb] = useState(!!clip.deReverb);
  const [autoDuck, setAutoDuck] = useState(!!clip.autoDuck);
  const [fx, setFx] = useState<AudioFx>(clip.audioFx ?? {});
  const [spectrumUri, setSpectrumUri] = useState<string | null>(null);
  const [specBusy, setSpecBusy] = useState(false);

  const showSpectrum = async () => {
    if (specBusy) {
      return;
    }
    setSpecBusy(true);
    try {
      const uri = await renderClipSpectrum(clip.uri);
      setSpectrumUri(uri);
      if (!uri) {
        Alert.alert(t('studio.audio.spectrum', { defaultValue: 'Spektrum' }), t('studio.pianoRoll.failed', { defaultValue: 'A render nem sikerült (fut a render-worker?).' }));
      }
    } finally {
      setSpecBusy(false);
    }
  };

  const wave = useWaveform(clip.uri);
  const sourceDuration = clip.sourceDuration ?? clip.duration; // a trim ENNYIN belül mozoghat
  const maxFade = Math.min(5, duration / 2);
  const clipPlayhead = playhead - clip.start;

  // A48: a PRO effekt-lánc a renderben hat (felhő, Pro) — Free-nél a paywall nyílik, nem egy
  // olyan beállítás, ami se nem hallható, se nem exportálható
  const isPro = useEntitlement((s) => s.isPro());
  const proFx = (apply: () => void) => {
    if (!isPro) {
      usePaywall.getState().open('cloudRender');
      return;
    }
    apply();
  };
  const patchFx = (p: Partial<AudioFx>) => proFx(() => setFx((prev) => ({ ...prev, ...p })));
  const eq = fx.eq ?? { low: 0, mid: 0, high: 0 };
  const setEq = (p: Partial<typeof eq>) => patchFx({ eq: { ...eq, ...p } });

  const dirty =
    volume !== clip.volume ||
    fadeIn !== clip.fadeIn ||
    fadeOut !== clip.fadeOut ||
    duration !== clip.duration ||
    trimIn !== (clip.trimIn ?? 0) ||
    pan !== (clip.pan ?? 0) ||
    voiceEnhance !== !!clip.voiceEnhance ||
    deReverb !== !!clip.deReverb ||
    autoDuck !== !!clip.autoDuck ||
    JSON.stringify(fx) !== JSON.stringify(clip.audioFx ?? {});

  // a vágás csak akkor ül a rácsra, ha a felhasználó állította — a késés-kompenzált take (count-in,
  // punch) pontos `trimIn`-je egy hangerő-állítástól nem csúszhat el
  const geometryChanged = duration !== clip.duration || trimIn !== (clip.trimIn ?? 0);
  // 🎙️🔁 take-választás: a függő (nem vágási) beállítások előbb mentődnek, aztán a take — a lap az
  // új take adataival épül újra (a kulcsa az aktív take)
  const pickTake = (takeId: string) => {
    if (dirty) {
      updateClip(clip.id, { volume, pan, fadeIn: Math.min(fadeIn, clip.duration), fadeOut: Math.min(fadeOut, clip.duration), voiceEnhance, deReverb, autoDuck, audioFx: fx } as Partial<AudioClip>);
    }
    const cmd = selectTakeCommand(clip, takeId);
    if (cmd) useEditorStore.getState().dispatch(cmd);
  };

  // 🥁↔️ ütemhez nyújtás: a forrás-tempó → sebesség (hangmagasság-tartással), a forrás-szakasz marad
  const projectBpm = useEditorStore((s) => s.project?.bpm ?? 120);
  const [srcBpm, setSrcBpm] = useState(clip.sourceBpm ?? projectBpm);
  const applyTempo = (patch: Partial<AudioClip> | null) => {
    if (!patch) {
      Alert.alert(t('studio.audio.tempo.title'), t('studio.audio.tempo.outOfRange'));
      return;
    }
    if (dirty) {
      updateClip(clip.id, { volume, pan, fadeIn: Math.min(fadeIn, clip.duration), fadeOut: Math.min(fadeOut, clip.duration), voiceEnhance, deReverb, autoDuck, audioFx: fx } as Partial<AudioClip>);
    }
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch });
  };

  const onDone = () => {
    if (dirty) {
      const snapped = geometryChanged ? snapToFrame(duration, fps) : clip.duration;
      updateClip(clip.id, {
        volume,
        pan,
        fadeIn: Math.min(fadeIn, snapped),
        fadeOut: Math.min(fadeOut, snapped),
        ...(geometryChanged ? { duration: Math.max(snapToFrame(0.1, fps), snapped), trimIn: snapToFrame(trimIn, fps) } : {}),
        sourceDuration,
        voiceEnhance,
        deReverb,
        autoDuck,
        audioFx: fx,
      } as Partial<AudioClip>);
    }
    onClose();
  };
  // 🧪 füstteszt: a „Kész” (csak __DEV__)
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => registerDevAction('clipEdit.done', () => onDoneRef.current()), []);
  // 🧪 füstteszt: a „Minta szerkesztése” gomb
  const editInstrumentNow = () => {
    if (!clip.instrumentDocId || !onEditInstrument) return false;
    const docId = clip.instrumentDocId;
    onDoneRef.current();
    onEditInstrument(docId);
    return true;
  };
  const editInstRef = useRef(editInstrumentNow);
  editInstRef.current = editInstrumentNow;
  useEffect(() => registerDevAction('clipEdit.editInstrument', () => editInstRef.current()), []);
  // 🧪 a füstteszt a presetekhez görget (képernyőkép)
  const scrollRef = useRef<ScrollView>(null);
  const presetsY = useRef(0);
  useEffect(() => registerDevAction('clipEdit.scrollToPresets', () => scrollRef.current?.scrollTo({ y: Math.max(0, presetsY.current - 40), animated: false })), []);

  return (
    <AudioSheetFrame id="clipEdit" onClose={onDone} sheetStyle={styles.sheet} tapToClose>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {clip.label || t('studio.audio.title')}
          </Text>
          {formatText ? (
            <Text style={styles.formatText} testID="clip-format">
              {formatText}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onDone} style={styles.doneBtn}>
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
        {clip.instrumentDocId && onEditInstrument ? (
          <Pressable
            testID="clip-edit-instrument"
            // a lap helyi módosításai előbb mentődnek, aztán nyílik a minta
            onPress={() => editInstRef.current()}
            style={styles.instrumentBtn}
            accessibilityRole="button"
          >
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={styles.instrumentText}>{t('studio.audio.editInstrument')}</Text>
          </Pressable>
        ) : null}
        <TakePicker clip={clip} onSelect={pickTake} />
        {!clip.reversed && !clip.loopLength ? (
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
        ) : null}
        <RegionBar
          trimIn={trimIn}
          duration={duration}
          sourceDuration={sourceDuration}
          fadeIn={fadeIn}
          fadeOut={fadeOut}
          playhead={clipPlayhead}
          peaks={wave?.peaks ?? null}
          waveDuration={wave?.duration ?? sourceDuration}
          onChange={({ trimIn: ti, duration: d }) => {
            setTrimIn(ti);
            setDuration(d);
            setFadeIn((v) => Math.min(v, d / 2));
            setFadeOut((v) => Math.min(v, d / 2));
          }}
        />

        {/* 🔊 klip-erősítés dB-ben: −∞ … +12 dB (0 dB-nél megáll) — a keverő a 0 dB fölötti erősítést is alkalmazza */}
        <Slider
          label={t('studio.audio.volume')}
          value={volumeToDb(volume)}
          min={CLIP_DB_MIN}
          max={CLIP_DB_MAX}
          onChange={(db) => setVolume(dbToVolume(db))}
          format={(db) => formatDb(dbToVolume(db))}
        />
        <Slider
          label={t('studio.audio.pan')}
          value={pan}
          min={-1}
          max={1}
          onChange={setPan}
          format={(v) =>
            v === 0 ? t('studio.audio.panCenter') : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`
          }
        />
        <Slider
          label={t('studio.audio.fadeIn')}
          value={fadeIn}
          min={0}
          max={maxFade}
          onChange={setFadeIn}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label={t('studio.audio.fadeOut')}
          value={fadeOut}
          min={0}
          max={maxFade}
          onChange={setFadeOut}
          format={(v) => `${v.toFixed(1)}s`}
        />

        {/* 🎚️ hangerő-automáció (value/time görbe) — élő, mint az AudioPanelben */}
        <Text style={styles.autoLabel}>{t('panels.audio.volumeAutomation')}</Text>
        <KeyframeGraphEditor
          keyframes={clip.keyframes?.volume ?? []}
          duration={clip.duration}
          min={0}
          max={CLIP_VOLUME_MAX}
          fallback={clip.volume}
          playhead={clamp(playhead - clip.start, 0, clip.duration)}
          onChange={(next) =>
            updateClip(clip.id, {
              keyframes: { ...clip.keyframes, volume: next.length > 0 ? next : undefined },
            })
          }
          onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
          formatValue={formatDb}
        />

        {/* 🎚️ pásztázás-automáció (−1…1 görbe) — a render per-frame aeval-lal égeti be */}
        <Text style={styles.autoLabel}>{t('studio.audio.panAutomation', { defaultValue: 'Pásztázás-automáció' })}</Text>
        <KeyframeGraphEditor
          keyframes={clip.keyframes?.pan ?? []}
          duration={clip.duration}
          min={-1}
          max={1}
          fallback={clip.pan ?? 0}
          playhead={clamp(playhead - clip.start, 0, clip.duration)}
          onChange={(next) =>
            updateClip(clip.id, {
              keyframes: { ...clip.keyframes, pan: next.length > 0 ? next : undefined },
            })
          }
          onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
          formatValue={(v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`)}
        />

        {/* 🎛️ effekt-automáció: a kiválasztott paraméter görbéje (szűrő-söprés, zengés, EQ…) */}
        <Text style={styles.autoLabel}>{t('studio.audio.fxAutomation.title')}</Text>
        <View style={styles.autoChips}>
          {FX_AUTO.map((ch) => {
            const active = autoChannel === ch.key;
            const used = (clip.keyframes?.[ch.key]?.length ?? 0) > 0;
            return (
              <Pressable
                key={ch.key}
                testID={`fx-auto-${ch.key}`}
                onPress={() => setAutoChannel(ch.key)}
                style={[styles.autoChip, active && styles.autoChipActive]}
              >
                <Text style={[styles.autoChipText, active && styles.autoChipTextActive]}>
                  {t(`studio.audio.fxAutomation.${ch.key}`)}
                  {used ? ' •' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {(() => {
          const ch = FX_AUTO.find((c) => c.key === autoChannel)!;
          return (
            <KeyframeGraphEditor
              keyframes={clip.keyframes?.[ch.key] ?? []}
              duration={clip.duration}
              min={ch.min}
              max={ch.max}
              fallback={ch.fallback(clip.audioFx)}
              playhead={clamp(playhead - clip.start, 0, clip.duration)}
              onChange={(next) =>
                updateClip(clip.id, {
                  keyframes: { ...clip.keyframes, [ch.key]: next.length > 0 ? next : undefined },
                })
              }
              onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
              formatValue={ch.format}
            />
          );
        })()}

        {/* 🔁 loop-klip: a jelenlegi szakasz ismétlődik, a jobb él a forrás végén túl is húzható */}
        {(clip.speed ?? 1) === 1 && !clip.reversed ? (
          <ToggleRow
            icon="repeat-outline"
            label={t('studio.audio.loopClip')}
            value={!!clip.loopLength}
            onValueChange={(on) =>
              updateClip(
                clip.id,
                on
                  ? { loopLength: clip.duration, loopOffset: undefined }
                  : {
                      loopLength: undefined,
                      loopOffset: undefined,
                      // ki: a klip nem lóghat túl a forráson
                      duration: Math.min(clip.duration, Math.max(0.1, (clip.sourceDuration ?? clip.duration) - (clip.trimIn ?? 0))),
                    }
              )
            }
          />
        ) : null}

        <View style={styles.divider} />
        <ToggleRow icon="sparkles-outline" label={t('studio.audio.enhance')} value={voiceEnhance} onValueChange={setVoiceEnhance} />
        <ToggleRow icon="mic-outline" label={t('studio.audio.deReverb')} value={deReverb} onValueChange={setDeReverb} />
        <ToggleRow icon="volume-low-outline" label={t('studio.audio.autoDuck')} value={autoDuck} onValueChange={setAutoDuck} />

        <View style={styles.divider} />
        <View style={styles.fxHead}>
          <Ionicons name="pulse-outline" size={15} color={palette.accent} />
          <Text style={styles.fxTitle}>{t('panels.audio.fxTitle')}</Text>
          <Pressable onPress={() => void showSpectrum()} hitSlop={6} style={styles.specBtn} disabled={specBusy}>
            {specBusy ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Ionicons name="stats-chart-outline" size={14} color={palette.accent} />
            )}
            <Text style={styles.specBtnText}>{t('studio.audio.spectrum', { defaultValue: 'Spektrum' })}</Text>
          </Pressable>
          <View style={styles.proTag}>
            <Text style={styles.proTagText}>PRO</Text>
          </View>
        </View>
        {spectrumUri ? (
          <Image source={{ uri: spectrumUri }} style={styles.spectrumImg} contentFit="contain" transition={120} />
        ) : null}
        {/* 🎙️✨ egy-koppintásos hang-FX presetek (a lenti szabályzókat előre beállítják) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow} onLayout={(e) => (presetsY.current = e.nativeEvent.layout.y)}>
          {AUDIO_FX_PRESETS.map((p) => (
            <Pressable
              key={p.key}
              testID={`audio-fx-preset-${p.key}`}
              style={styles.presetChip}
              onPress={() => proFx(() => setFx(presetFx(p.key)))}
            >
              <Ionicons name={p.icon as keyof typeof Ionicons.glyphMap} size={14} color={palette.accent} />
              <Text style={styles.presetChipText}>{t(`studio.audio.fxPreset.${p.key}`, { defaultValue: p.label })}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {/* ⭐ saját presetek: a mostani effektek mentése, egy koppintással vissza */}
        <UserPresetRow kind="clipFx" getValue={() => fx} onApply={(v) => proFx(() => setFx(JSON.parse(JSON.stringify(v))))} />
        {/* 🎚️ hangmagasság-eltolás (transzponálás, hossz-tartó) — −12…+12 félhang */}
        <Slider
          label={t('studio.audio.fxPitch', { defaultValue: 'Hangmagasság (félhang)' })}
          value={fx.pitchSemitones ?? 0}
          min={-12}
          max={12}
          onChange={(v) => patchFx({ pitchSemitones: Math.round(v) })}
          format={(v) => (Math.round(v) === 0 ? t('common.off') : `${v > 0 ? '+' : ''}${Math.round(v)}`)}
        />
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
        <Text style={styles.hint}>{t('panels.audio.mixHint')}</Text>

        {/* 🔀 effekt-sorrend: az aktív fokozatok a lánc sorrendjében, léptetéssel (előnézet = export) */}
        {(() => {
          const activeStage = (st: FxStage) =>
            st === 'filters' ? !!(fx.highpass || fx.lowpass) : st === 'eq' ? !!(fx.eq?.low || fx.eq?.mid || fx.eq?.high) : st === 'reverb' ? (fx.reverb ?? 0) > 0 : st === 'delay' ? (fx.delay ?? 0) > 0 : !!fx[st];
          const order = fxStageOrder(fx.order).filter(activeStage);
          if (order.length < 2) return null;
          return (
            <View style={styles.orderBox} testID="fx-order">
              <Text style={styles.autoLabel}>{t('studio.audio.fxOrder.title')}</Text>
              {order.map((st, i) => (
                <View key={st} style={styles.orderRow}>
                  <Text style={styles.orderName}>{`${i + 1}. ${t(`studio.audio.fxOrder.stage.${st}`)}`}</Text>
                  <Pressable onPress={() => patchFx({ order: moveStage(fx.order, st, -1) })} disabled={i === 0} hitSlop={6} style={[styles.orderBtn, i === 0 && { opacity: 0.3 }]} accessibilityLabel={t('studio.audio.fxOrder.up')}>
                    <Ionicons name="chevron-up" size={16} color={palette.text} />
                  </Pressable>
                  <Pressable onPress={() => patchFx({ order: moveStage(fx.order, st, 1) })} disabled={i === order.length - 1} hitSlop={6} style={[styles.orderBtn, i === order.length - 1 && { opacity: 0.3 }]} accessibilityLabel={t('studio.audio.fxOrder.down')}>
                    <Ionicons name="chevron-down" size={16} color={palette.text} />
                  </Pressable>
                </View>
              ))}
              <Text style={styles.hint}>{t('studio.audio.fxOrder.hint')}</Text>
            </View>
          );
        })()}

        {/* 🔇 csendek keresése → jóváhagyás az idővonalon */}
        <View style={styles.divider} />
        <Pressable
          testID="clip-find-silence"
          onPress={() => {
            const track = useEditorStore.getState().project?.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id));
            if (!track) return;
            onClose();
            void startSilenceSearch(clip, track.type, fps, t);
          }}
          style={styles.stemsBtn}
        >
          <Ionicons name="cut-outline" size={16} color={palette.accent} />
          <Text style={styles.stemsText}>{t('studio.audio.silence.find')}</Text>
        </Pressable>
        <Text style={styles.hint}>{t('studio.audio.silence.findHint')}</Text>

        {/* ✂️💬 szöveges vágás: a sáv átirata az idővonal alatt */}
        <Pressable
          testID="clip-speech-edit"
          onPress={() => {
            const track = useEditorStore.getState().project?.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id));
            if (!track) return;
            onClose();
            void startSpeechEdit(track.type, t);
          }}
          style={[styles.stemsBtn, { marginTop: 12 }]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={palette.accent} />
          <Text style={styles.stemsText}>{t('studio.audio.speech.open')}</Text>
        </Pressable>
        <Text style={styles.hint}>{t('studio.audio.speech.openHint')}</Text>

        {/* 🔗 külső hang szinkronja a hangja alapján */}
        <Pressable
          testID="clip-audio-sync"
          onPress={() => {
            onClose();
            startAudioSync(clip, fps, t);
          }}
          style={[styles.stemsBtn, { marginTop: 12 }]}
        >
          <Ionicons name="git-compare-outline" size={16} color={palette.accent} />
          <Text style={styles.stemsText}>{t('studio.audio.sync.open')}</Text>
        </Pressable>
        <Text style={styles.hint}>{t('studio.audio.sync.openHint', { sec: 30 })}</Text>

        {/* 🎚️ AI stem-szeparáció (Pro) — kiadásból elrejtve, lásd STEM_SEPARATION_ENABLED */}
        {STEM_SEPARATION_ENABLED ? (
          <>
            <View style={styles.divider} />
            <Pressable onPress={onSeparate} disabled={separating} style={styles.stemsBtn}>
              <Ionicons
                name={separating ? 'hourglass-outline' : 'git-branch-outline'}
                size={16}
                color={palette.accent}
              />
              <Text style={styles.stemsText}>{t('studio.audio.stems')}</Text>
              <View style={styles.proTag}>
                <Text style={styles.proTagText}>PRO</Text>
              </View>
            </Pressable>
            <Text style={styles.hint}>{t('studio.audio.stemsHint')}</Text>
          </>
        ) : null}
      </ScrollView>
    </AudioSheetFrame>
  );
}

/** kényelmi: a store-projektből a kijelölt hangklip (vagy null). */
export function selectedAudioClip(project: Project | null, selectedClipId: string | null): AudioClip | null {
  if (!project || !selectedClipId) {
    return null;
  }
  for (const track of project.tracks) {
    const found = track.clips.find((c) => c.id === selectedClipId);
    if (found && found.kind === 'audio') {
      return found;
    }
  }
  return null;
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#0b0d14',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    maxHeight: '82%',
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { flex: 1, color: palette.text, fontSize: 16, fontWeight: '800' },
  formatText: { color: palette.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 12 },
  fxHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  fxTitle: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '800' },
  proTag: { backgroundColor: palette.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proTagText: { color: palette.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  presetRow: { gap: 6, paddingVertical: 2, paddingRight: 8, marginBottom: 6 },
  orderBox: { marginTop: 8, gap: 6 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10 },
  orderName: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  orderBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border },
  instrumentBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: 10, backgroundColor: palette.accent, marginBottom: 12 },
  instrumentText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  tempoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  tempoLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  tempoBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border },
  tempoVal: { color: palette.text, fontSize: 15, fontWeight: '800', minWidth: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  tempoGo: { paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 10, backgroundColor: palette.accent },
  tempoGoText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  tempoSpeed: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: palette.surface },
  presetChipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  specBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  specBtnText: { color: palette.accent, fontSize: 11, fontWeight: '700' },
  spectrumImg: { width: '100%', height: 150, borderRadius: 8, marginBottom: 8, backgroundColor: '#000' },
  hint: { color: palette.textDim, fontSize: 11, lineHeight: 16, marginTop: 10 },
  autoLabel: { color: palette.textDim, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 4 },
  autoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  autoChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: palette.border },
  autoChipActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  autoChipText: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  autoChipTextActive: { color: '#fff' },
  stemsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  stemsText: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '700' },
});
