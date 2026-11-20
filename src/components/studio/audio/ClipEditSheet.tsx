import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { registerDevAction } from '@/lib/devActions';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { AiDenoiseSection } from '@/components/studio/audio/clipEdit/AiDenoiseSection';
import { ClipAutomationSection } from '@/components/studio/audio/clipEdit/ClipAutomationSection';
import { createClipCommitActions } from '@/components/studio/audio/clipEdit/clipCommitActions';
import { ClipLevelSection } from '@/components/studio/audio/clipEdit/ClipLevelSection';
import { ClipToggleSection } from '@/components/studio/audio/clipEdit/ClipToggleSection';
import { createClipToolActions } from '@/components/studio/audio/clipEdit/clipToolActions';
import { ClipToolsSection } from '@/components/studio/audio/clipEdit/ClipToolsSection';
import { FxOrderSection } from '@/components/studio/audio/clipEdit/FxOrderSection';
import { FxParamsSection } from '@/components/studio/audio/clipEdit/FxParamsSection';
import { FxPresetsSection } from '@/components/studio/audio/clipEdit/FxPresetsSection';
import { TempoMatchRow } from '@/components/studio/audio/clipEdit/TempoMatchRow';
import { VoiceTuneSection } from '@/components/studio/audio/clipEdit/VoiceTuneSection';
import { AUDIO_FX_PRESETS, presetFx } from '@/lib/audioFxPresets';
import { useWaveform } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import { AUDIO_EDIT_RATE } from '@/lib/frames';
import { eqBandParams } from '@/lib/fxParams';
import { bpmAt } from '@/lib/audioTransport';
import { clipEditDirty, paramEqCustomized, type FxAutoKey } from '@/lib/clipEditOps';
import { TakePicker } from '@/components/studio/audio/TakePicker';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, AudioFx, Project } from '@/types/project';
import { audioFormatLabel } from '@/lib/audioFormat';

// REFACTOR: a szekciók a clipEdit/ alatt, a tiszta számítások a src/lib/clipEditOps.ts-ben

/**
 * 🎚️ Klip-szerkesztő lap — a kijelölt hangklip nem-destruktív szerkesztése
 * (trim / fade / hangerő / pan / enhance / effektek). Minden a `HangStudio`-ból
 * ismert mintát követi: a lap LOKÁLIS állapotban dolgozik, és a „Kész" EGY
 * `updateClip`-pel commitál → EGY undo-lépés. A vágás/keyframe a projekt rácsára ül (hang-projektben a mintára — V6).
 */
export function ClipEditSheet({
  clip,
  fps,
  onClose,
  onEditInstrument,
  onTune,
  onResetTune,
  onHumMelody,
  onStemsOnDevice,
  onAiDenoise,
  onResetAiDenoise,
}: {
  clip: AudioClip;
  fps: number;
  onClose: () => void;
  /** 🎤 V3.2: ének-hangolás (a stúdió végzi; a lap előbb bezárul és ment) */
  onTune?: (clipId: string, s: { root: number; minor: boolean; strength: number; harmonySteps?: number }) => void;
  onResetTune?: (clipId: string) => void;
  /** 🎵 V8: dúdolásból dallam — a klip hangjai szerkeszthető szinti-mintába, a választott hangnemre húzva */
  onHumMelody?: (clipId: string, key: { root: number; minor: boolean }) => void;
  /** 🎚️ V5: ének + kíséret szétválasztása a telefonon (ingyenes) */
  onStemsOnDevice?: (clipId: string) => void;
  /** 🔇 V8: AI-zajszűrés a telefonon (RNNoise), erősséggel; visszaállítható */
  onAiDenoise?: (clipId: string, strength: number) => void;
  onResetAiDenoise?: (clipId: string) => void;
  /** 🎹🥁 a sütött hangszer-klip mintájának újraszerkesztése (a dobgép / piano roll nyílik) */
  onEditInstrument?: (docId: string) => void;
}) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const applyBatch = useEditorStore((s) => s.applyBatch);
  const playhead = useEditorStore((s) => s.playhead);
  // 🎧 V6: a kulcskockák ideje hang-projektben a mintára (a `fps` itt a szerkesztési rács), különben ezredmásodpercre
  const kfRate = fps === AUDIO_EDIT_RATE ? AUDIO_EDIT_RATE : 1000;
  // 🎚️ S16: a forrás formátuma (az asseten, importkor kiolvasva)
  const asset = useEditorStore((s) => (clip.assetId ? s.project?.assets.find((a) => a.id === clip.assetId) : undefined));
  const formatText = asset ? audioFormatLabel(asset, { mono: t('studio.audio.format.mono'), stereo: t('studio.audio.format.stereo'), channels: (n) => t('studio.audio.format.channels', { count: n }) }) : '';
  const [separating, setSeparating] = useState(false);
  const [autoChannel, setAutoChannel] = useState<FxAutoKey>('fxLowpass');
  // 🎤 V3.2: ének-hangolás beállításai (a klip mentett beállításaiból)
  const [tuneRoot, setTuneRoot] = useState(() => clip.tune?.root ?? 0);
  const [tuneMinor, setTuneMinor] = useState(() => clip.tune?.minor ?? false);
  const [tuneStrength, setTuneStrength] = useState(() => clip.tune?.strength ?? 1);
  const [tuneHarmony, setTuneHarmony] = useState<number>(() => clip.tune?.harmonySteps ?? 0);
  const [aiStrength, setAiStrength] = useState<number>(() => clip.aiDenoise?.strength ?? 1);

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

  const wave = useWaveform(clip.uri);
  const sourceDuration = clip.sourceDuration ?? clip.duration; // a trim ENNYIN belül mozoghat
  const maxFade = Math.min(5, duration / 2);
  const clipPlayhead = playhead - clip.start;

  // 🆓 2026-11-14 (tulajdonosi döntés): ami a telefonon fut, az ingyenes, a felhő fizetős. A klip-effektek a
  // telefonos exportban és előnézetben a közös DSP-n (`audioDsp.ts`) szólnak → Free-ben is állíthatók; Pro csak a
  // felhős render (az export útja dönti el, nem ez a lap)
  const proFx = (apply: () => void) => apply();
  const patchFx = (p: Partial<AudioFx>) => proFx(() => setFx((prev) => ({ ...prev, ...p })));
  const eq = fx.eq ?? { low: 0, mid: 0, high: 0 };
  const setEq = (p: Partial<typeof eq>) => patchFx({ eq: { ...eq, ...p } });
  // 🎛️ V7: parametrikus EQ (sávonként frekvencia + Q) — alapból rejtve, a régi 3 csúszka marad elöl
  const [paramEq, setParamEq] = useState(() => paramEqCustomized(fx.eq));
  const bands = eqBandParams(fx.eq);
  // 🥁 V7: a delay ütemre — a klip helyén érvényes tempóból (a reducer is ebből számol)
  const bpmHere = useEditorStore((st) => (st.project ? bpmAt(st.project, clip.start) : 120));

  const settings = { volume, fadeIn, fadeOut, duration, trimIn, pan, voiceEnhance, deReverb, autoDuck, fx };
  const dirty = clipEditDirty(clip, settings);

  // 🥁↔️ ütemhez nyújtás: a forrás-tempó → sebesség (hangmagasság-tartással), a forrás-szakasz marad
  const projectBpm = useEditorStore((s) => s.project?.bpm ?? 120);
  const [srcBpm, setSrcBpm] = useState(clip.sourceBpm ?? projectBpm);
  const { pickTake, applyTempo, onDone } = createClipCommitActions({ clip, fps, t, settings, dirty, sourceDuration, updateClip, onClose });
  const { onSeparate, showSpectrum, findSilence, openSpeechEdit, openAudioSync } = createClipToolActions({
    clip,
    fps,
    t,
    onClose,
    applyBatch,
    setSeparating,
    specBusy,
    setSpecBusy,
    setSpectrumUri,
  });

  // 🧪 füstteszt: a „Kész” (csak __DEV__)
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => registerDevAction('clipEdit.done', () => onDoneRef.current()), []);
  // 🧪 füstteszt: egy effekt-preset a lap valódi útján (a Free/Pro döntés is itt fut)
  const presetRef = useRef((key: string) => proFx(() => setFx(presetFx(key as (typeof AUDIO_FX_PRESETS)[number]['key']))));
  presetRef.current = (key: string) => proFx(() => setFx(presetFx(key as (typeof AUDIO_FX_PRESETS)[number]['key'])));
  useEffect(() => registerDevAction('clipEdit.applyFxPreset', (key) => {
    presetRef.current(String(key));
    return true;
  }), []);
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
          <TempoMatchRow clip={clip} srcBpm={srcBpm} setSrcBpm={setSrcBpm} projectBpm={projectBpm} applyTempo={applyTempo} />
        ) : null}
        <ClipLevelSection
          trimIn={trimIn}
          duration={duration}
          sourceDuration={sourceDuration}
          fadeIn={fadeIn}
          fadeOut={fadeOut}
          volume={volume}
          pan={pan}
          maxFade={maxFade}
          clipPlayhead={clipPlayhead}
          wave={wave}
          setTrimIn={setTrimIn}
          setDuration={setDuration}
          setFadeIn={setFadeIn}
          setFadeOut={setFadeOut}
          setVolume={setVolume}
          setPan={setPan}
        />

        <ClipAutomationSection clip={clip} kfRate={kfRate} playhead={playhead} autoChannel={autoChannel} setAutoChannel={setAutoChannel} updateClip={updateClip} />

        <ClipToggleSection
          clip={clip}
          updateClip={updateClip}
          voiceEnhance={voiceEnhance}
          setVoiceEnhance={setVoiceEnhance}
          deReverb={deReverb}
          setDeReverb={setDeReverb}
          autoDuck={autoDuck}
          setAutoDuck={setAutoDuck}
        />

        <FxPresetsSection fx={fx} setFx={setFx} proFx={proFx} specBusy={specBusy} spectrumUri={spectrumUri} showSpectrum={showSpectrum} presetsY={presetsY} />
        {onAiDenoise ? (
          <AiDenoiseSection clip={clip} aiStrength={aiStrength} setAiStrength={setAiStrength} onAiDenoise={onAiDenoise} onResetAiDenoise={onResetAiDenoise} />
        ) : null}
        {onTune ? (
          <VoiceTuneSection
            clip={clip}
            tuneRoot={tuneRoot}
            setTuneRoot={setTuneRoot}
            tuneMinor={tuneMinor}
            setTuneMinor={setTuneMinor}
            tuneStrength={tuneStrength}
            setTuneStrength={setTuneStrength}
            tuneHarmony={tuneHarmony}
            setTuneHarmony={setTuneHarmony}
            onTune={onTune}
            onHumMelody={onHumMelody}
            onResetTune={onResetTune}
          />
        ) : null}
        <FxParamsSection fx={fx} patchFx={patchFx} eq={eq} setEq={setEq} paramEq={paramEq} setParamEq={setParamEq} bands={bands} bpmHere={bpmHere} />

        <FxOrderSection fx={fx} patchFx={patchFx} />

        <ClipToolsSection
          clipId={clip.id}
          separating={separating}
          onSeparate={onSeparate}
          findSilence={findSilence}
          openSpeechEdit={openSpeechEdit}
          openAudioSync={openAudioSync}
          onStemsOnDevice={onStemsOnDevice}
        />
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
  instrumentBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: 10, backgroundColor: palette.accent, marginBottom: 12 },
  instrumentText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
