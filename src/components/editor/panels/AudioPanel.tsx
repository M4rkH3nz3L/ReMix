import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { Chip, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { detectBeats, timelineBeats } from '@/lib/beats';
import { makeId } from '@/lib/id';
import { pickAudio } from '@/lib/media';
import { downloadTrack, fetchSoundLibrary } from '@/lib/render';
import type { LibraryTrack } from '@/lib/render';
import { projectMusicTarget, rankLibrary, trackMatchScore } from '@/lib/musicMatch';
import { fetchTtsVoices, generateTts, type TtsVoice } from '@/lib/tts';
import { clamp, formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import type { AudioClip, AudioFx, TextClip } from '@/types/project';

/**
 * Hang-panel: voiceover-felvétel közvetlenül az appból + a kijelölt hangklip
 * keverése (hangerő, fade in/out).
 */
export function AudioPanel({ clip }: { clip: AudioClip | null }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const addClip = useEditorStore((s) => s.addClip);
  // 🥁 beat → marker / vágás
  const suggestedCuts = useEditorStore((s) => s.suggestedCuts);
  const hasAudio = useEditorStore((s) =>
    (s.project?.tracks ?? []).some(
      (tk) => (tk.type === 'music' || tk.type === 'voiceover' || tk.type === 'sfx') && tk.clips.length > 0
    )
  );
  const [beatMode, setBeatMode] = useState<'beat' | 'downbeat'>('downbeat');
  const [beatBusy, setBeatBusy] = useState(false);
  const playhead = useEditorStore((s) => s.playhead);

  // 🎛️ per-klip audio-FX olvasó/író segédek (a kijelölt klipre)
  const fx: AudioFx = clip?.audioFx ?? {};
  const eq = fx.eq ?? { low: 0, mid: 0, high: 0 };
  const setFx = (patch: Partial<AudioFx>) => {
    if (clip) {
      updateClip(clip.id, { audioFx: { ...fx, ...patch } });
    }
  };
  const setEq = (patch: Partial<typeof eq>) => setFx({ eq: { ...eq, ...patch } });
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const panLabel = (p: number) =>
    Math.abs(p) < 0.05
      ? t('panels.audio.panCenter')
      : `${p < 0 ? t('panels.audio.panL') : t('panels.audio.panR')} ${Math.round(Math.abs(p) * 100)}%`;

  /**
   * A beat-rács forrása: a zenesáv első klipje (vagy a kijelölt hangklip). A
   * detektálás fájlonként cache-elt; ha még nincs rács a store-ban, itt kérjük le.
   */
  const beatSource = (): AudioClip | null => {
    const project = useEditorStore.getState().project;
    const music = project?.tracks
      .find((x) => x.type === 'music')
      ?.clips.filter((c): c is AudioClip => c.kind === 'audio')
      .sort((a, b) => a.start - b.start)[0];
    return music ?? clip ?? null;
  };
  const ensureBeats = async (): Promise<boolean> => {
    const st = useEditorStore.getState();
    if (st.beatTimes.length > 0) {
      return true;
    }
    const src = beatSource();
    if (!src) {
      return false;
    }
    setBeatBusy(true);
    try {
      const grid = await detectBeats(src.uri);
      if (!grid || grid.beats.length === 0) {
        return false;
      }
      st.setBeatGrid(timelineBeats(src, grid.beats), timelineBeats(src, grid.downbeats));
      return true;
    } finally {
      setBeatBusy(false);
    }
  };
  const runBeatMarkers = async () => {
    if (!(await ensureBeats())) {
      Alert.alert(t('panels.audio.beatTitle'), t('panels.audio.beatNone'));
      return;
    }
    const n = useEditorStore.getState().markersFromBeats(beatMode);
    Alert.alert(t('panels.audio.beatTitle'), t('panels.audio.beatMarkersDone', { count: n }));
  };
  const runBeatCuts = async () => {
    if (!(await ensureBeats())) {
      Alert.alert(t('panels.audio.beatTitle'), t('panels.audio.beatNone'));
      return;
    }
    useEditorStore.getState().cutsFromBeats(beatMode);
  };

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recordStartPlayhead = useRef(0);

  const [library, setLibrary] = useState<LibraryTrack[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  // 🎵 videóhoz-illesztés: a könyvtár rangsorolása a projekt energiájához
  const [matchMode, setMatchMode] = useState(false);

  // 🗣️ AI-hang (TTS)
  const [ttsText, setTtsText] = useState('');
  const [ttsVoices, setTtsVoices] = useState<TtsVoice[]>([]);
  const [ttsVoice, setTtsVoice] = useState<string | undefined>(undefined);
  const [ttsAvailable, setTtsAvailable] = useState<boolean | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);

  useEffect(() => {
    fetchSoundLibrary()
      .then(setLibrary)
      .catch(() => setLibraryError(true));
    fetchTtsVoices()
      .then((r) => {
        setTtsAvailable(r.available);
        setTtsVoices(r.voices);
        setTtsVoice(r.voices[0]?.name);
      })
      .catch(() => setTtsAvailable(false));
  }, []);

  const generateVoice = () => {
    const text = ttsText.trim();
    if (!text || ttsBusy) {
      return;
    }
    setTtsBusy(true);
    generateTts(text, ttsVoice)
      .then(({ uri, duration }) => {
        addAudioClip(uri, t('panels.audio.aiVoiceLabel'), duration, 'local', 'voiceover');
        setTtsText('');
      })
      .catch((err: Error) => Alert.alert(t('panels.audio.aiVoiceLabel'), err.message))
      .finally(() => setTtsBusy(false));
  };

  /**
   * 🎙️ Dub feliratokból (Phase 4.3): a felirat-sáv szövegéből (ami a 4.2-vel
   * akár lefordított is lehet) AI-narrációt generál a kiválasztott hanggal, és a
   * beszéd kezdetéhez időzítve a voiceover-sávra teszi. EGY narrációs sáv (nem
   * per-szegmens lip-sync); az eredeti hang halkítása a mixerből. Pro (TTS).
   */
  const runDub = async () => {
    if (ttsBusy) {
      return;
    }
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((tk) => tk.type === 'captions');
    const caps = (track?.clips ?? [])
      .filter((c): c is TextClip => c.kind === 'text')
      .sort((a, b) => a.start - b.start);
    if (caps.length === 0) {
      Alert.alert(t('panels.audio.dubTitle'), t('panels.audio.dubNoCaptions'));
      return;
    }
    const text = caps.map((c) => c.text).join(' ').trim().slice(0, 4000);
    setTtsBusy(true);
    try {
      await guardPro(
        async () => {
          const { uri, duration } = await generateTts(text, ttsVoice);
          state.setPlayhead(Math.max(0, caps[0].start));
          addAudioClip(uri, t('panels.audio.dubLabel'), duration, 'local', 'voiceover');
          Alert.alert(t('panels.audio.dubTitle'), t('panels.audio.dubDone'));
        },
        (e) => Alert.alert(t('panels.audio.dubTitle'), e.message)
      );
    } finally {
      setTtsBusy(false);
    }
  };

  const addAudioClip = (
    uri: string,
    label: string,
    duration: number,
    provider: 'local' | 'library' = 'local',
    trackType: 'music' | 'voiceover' | 'sfx' = 'music'
  ) => {
    addClip(
      trackType,
      {
        kind: 'audio',
        id: makeId('clip'),
        start: useEditorStore.getState().playhead,
        duration: Math.max(duration, 0.3),
        uri,
        label,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        source: 'imported',
      },
      {
        id: makeId('ast'),
        kind: 'audio',
        uri,
        provider,
        name: label,
        duration: Math.max(duration, 0.3),
      }
    );
  };

  const addFromLibrary = (track: LibraryTrack) => {
    if (busyTrack) {
      return;
    }
    setBusyTrack(track.id);
    downloadTrack(track)
      .then((uri) =>
        addAudioClip(
          uri,
          track.name,
          track.duration,
          'library',
          // az SFX-ek a saját sávjukra kerülnek, a zenék a zenesávra
          track.kind === 'sfx' ? 'sfx' : 'music'
        )
      )
      .catch(() => Alert.alert(t('common.error'), t('panels.audio.downloadFailed')))
      .finally(() => setBusyTrack(null));
  };

  const importOwn = async () => {
    const picked = await pickAudio();
    if (picked) {
      addAudioClip(picked.uri, picked.name, 10);
    }
  };

  const toggleRecord = async () => {
    if (recorderState.isRecording) {
      const seconds = Math.max(recorderState.durationMillis / 1000, 0.5);
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        addClip(
          'voiceover',
          {
            kind: 'audio',
            id: makeId('clip'),
            start: recordStartPlayhead.current,
            duration: seconds,
            uri,
            label: t('panels.audio.voiceoverLabel'),
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            source: 'voiceover',
          },
          {
            id: makeId('ast'),
            kind: 'audio',
            uri,
            provider: 'local',
            name: t('panels.audio.voiceoverLabel'),
            duration: seconds,
          }
        );
      }
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('panels.audio.micPermissionTitle'), t('panels.audio.micPermissionMessage'));
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recordStartPlayhead.current = useEditorStore.getState().playhead;
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  return (
    <View>
      <PanelSection title={t('panels.audio.libraryTitle')}>
        {library === null && !libraryError ? (
          <Text style={styles.note}>{t('panels.audio.libraryLoading')}</Text>
        ) : libraryError ? (
          <Text style={styles.note}>
            {t('panels.audio.libraryError')}
          </Text>
        ) : (
          <View style={styles.trackList}>
            {(() => {
              const project = useEditorStore.getState().project;
              const on = matchMode && !!project;
              const target = on ? projectMusicTarget(project!) : 0;
              const shown = on ? rankLibrary(library!, project!) : library!;
              return (
                <>
                  <Pressable
                    onPress={() => setMatchMode((v) => !v)}
                    hitSlop={6}
                    style={[styles.matchToggle, on ? styles.matchToggleOn : null]}
                  >
                    <Text style={[styles.matchToggleText, on ? styles.matchToggleTextOn : null]}>
                      {t('panels.audio.matchToVideo')}
                    </Text>
                  </Pressable>
                  {shown.map((track) => (
                    <Pressable
                      key={track.id}
                      style={styles.trackRow}
                      onPress={() => addFromLibrary(track)}
                    >
                      <Text style={styles.trackIcon}>{track.kind === 'music' ? '🎵' : '💥'}</Text>
                      <Text style={styles.trackName} numberOfLines={1}>
                        {busyTrack === track.id ? t('panels.audio.downloading') : track.name}
                      </Text>
                      {on ? (
                        <Text style={styles.matchBadge}>
                          {Math.round(trackMatchScore(track, target) * 100)}%
                        </Text>
                      ) : null}
                      <Text style={styles.trackDuration}>{t('panels.audio.seconds', { value: track.duration.toFixed(1) })}</Text>
                    </Pressable>
                  ))}
                </>
              );
            })()}
            <Text style={styles.note}>
              {t('panels.audio.libraryHint')}
            </Text>
          </View>
        )}
      </PanelSection>

      <PanelSection title={t('panels.audio.ownFileTitle')}>
        <PrimaryButton
          icon="folder-open-outline"
          label={t('panels.audio.importMusic')}
          onPress={() => {
            importOwn().catch(() => Alert.alert(t('common.error'), t('panels.audio.importFailed')));
          }}
        />
      </PanelSection>

      <PanelSection title={t('panels.audio.voiceoverTitle')}>
        <PrimaryButton
          icon={recorderState.isRecording ? 'stop' : 'mic'}
          label={
            recorderState.isRecording
              ? t('panels.audio.stopRecording', { time: formatTime(recorderState.durationMillis / 1000) })
              : t('panels.audio.startRecording')
          }
          onPress={() => {
            toggleRecord().catch(() => {
              Alert.alert(t('common.error'), t('panels.audio.recordFailed'));
            });
          }}
        />
        <Text style={styles.note}>
          {t('panels.audio.voiceoverHint')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.audio.ttsTitle')}>
        {ttsAvailable === false ? (
          <Text style={styles.note}>
            {t('panels.audio.ttsUnavailable')}
          </Text>
        ) : (
          <>
            <TextInput
              value={ttsText}
              onChangeText={setTtsText}
              placeholder={t('panels.audio.ttsPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.ttsInput}
              multiline
            />
            {ttsVoices.length > 0 ? (
              <View style={styles.chipRow}>
                {ttsVoices.map((v) => (
                  <Chip
                    key={v.name}
                    label={`${v.name} · ${v.locale.slice(0, 2)}`}
                    active={ttsVoice === v.name}
                    onPress={() => setTtsVoice(v.name)}
                  />
                ))}
              </View>
            ) : null}
            {ttsBusy ? (
              <View style={styles.ttsBusy}>
                <ActivityIndicator color={palette.accent} />
                <Text style={styles.note}>{t('panels.audio.ttsGenerating')}</Text>
              </View>
            ) : (
              <>
                <PrimaryButton icon="sparkles" label={t('panels.audio.generateVoice')} onPress={generateVoice} />
                <PrimaryButton
                  icon="language-outline"
                  label={t('panels.audio.dubBtn')}
                  onPress={() => {
                    runDub().catch((err: Error) => Alert.alert(t('panels.audio.dubTitle'), err.message));
                  }}
                />
              </>
            )}
            <Text style={styles.note}>
              {t('panels.audio.ttsHint')}
            </Text>
            <Text style={styles.note}>
              {t('panels.audio.dubNote')}
            </Text>
          </>
        )}
      </PanelSection>

      {hasAudio ? (
        <PanelSection title={t('panels.audio.beatTitle')}>
          <View style={styles.chipRow}>
            <Chip
              label={t('panels.audio.beatDownbeat')}
              active={beatMode === 'downbeat'}
              onPress={() => setBeatMode('downbeat')}
            />
            <Chip
              label={t('panels.audio.beatEveryBeat')}
              active={beatMode === 'beat'}
              onPress={() => setBeatMode('beat')}
            />
          </View>
          {beatBusy ? (
            <View style={styles.ttsBusy}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.note}>{t('panels.audio.beatDetecting')}</Text>
            </View>
          ) : (
            <View style={styles.chipRow}>
              <Chip
                label={t('panels.audio.beatToMarkers')}
                active={false}
                onPress={() => {
                  runBeatMarkers().catch(() => {});
                }}
              />
              <Chip
                label={t('panels.audio.beatToCuts')}
                active={false}
                onPress={() => {
                  runBeatCuts().catch(() => {});
                }}
              />
            </View>
          )}
          {suggestedCuts.length > 0 ? (
            <>
              <PrimaryButton
                icon="cut"
                label={t('panels.audio.beatApplyCuts', { count: suggestedCuts.length })}
                onPress={() => useEditorStore.getState().applySuggestedCuts()}
              />
              <View style={styles.chipRow}>
                <Chip
                  label={t('panels.audio.beatDiscardCuts')}
                  active={false}
                  onPress={() => useEditorStore.getState().clearSuggestedCuts()}
                />
              </View>
            </>
          ) : null}
          <Text style={styles.note}>{t('panels.audio.beatHint')}</Text>
        </PanelSection>
      ) : null}

      {clip ? (
        <>
        <PanelSection title={t('panels.audio.mixTitle', { label: clip.label })}>
          <PrimaryButton
            icon="options-outline"
            label={t('panels.audio.openHangStudio')}
            onPress={() => useEditorStore.getState().openAudioStudio(clip.id)}
          />
          <Stepper
            label={t('panels.audio.volume')}
            value={`${Math.round(clip.volume * 100)}%`}
            onDec={() => updateClip(clip.id, { volume: clamp(clip.volume - 0.1, 0, 1) })}
            onInc={() => updateClip(clip.id, { volume: clamp(clip.volume + 0.1, 0, 1) })}
          />
          <Stepper
            label="Fade in"
            value={t('panels.audio.seconds', { value: clip.fadeIn.toFixed(1) })}
            onDec={() => updateClip(clip.id, { fadeIn: clamp(clip.fadeIn - 0.5, 0, 10) })}
            onInc={() => updateClip(clip.id, { fadeIn: clamp(clip.fadeIn + 0.5, 0, 10) })}
          />
          <Stepper
            label="Fade out"
            value={t('panels.audio.seconds', { value: clip.fadeOut.toFixed(1) })}
            onDec={() => updateClip(clip.id, { fadeOut: clamp(clip.fadeOut - 0.5, 0, 10) })}
            onInc={() => updateClip(clip.id, { fadeOut: clamp(clip.fadeOut + 0.5, 0, 10) })}
          />
          {/* 🎚️ sztereó pásztázás (bal ↔ jobb) — a renderben */}
          <Stepper
            label={t('panels.audio.pan')}
            value={panLabel(clip.pan ?? 0)}
            onDec={() => updateClip(clip.id, { pan: clamp(round1((clip.pan ?? 0) - 0.2), -1, 1) })}
            onInc={() => updateClip(clip.id, { pan: clamp(round1((clip.pan ?? 0) + 0.2), -1, 1) })}
          />
          <View style={styles.chipRow}>
            {clip.source === 'voiceover' ? (
              <>
                <Chip
                  label={t('panels.audio.enhanceVoice')}
                  active={clip.voiceEnhance === true}
                  onPress={() => updateClip(clip.id, { voiceEnhance: !clip.voiceEnhance })}
                />
                <Chip
                  label={t('panels.audio.deReverb')}
                  active={clip.deReverb === true}
                  onPress={() => updateClip(clip.id, { deReverb: !clip.deReverb })}
                />
              </>
            ) : (
              <Chip
                label={t('panels.audio.autoDuck')}
                active={clip.autoDuck === true}
                onPress={() => updateClip(clip.id, { autoDuck: !clip.autoDuck })}
              />
            )}
          </View>
          {/* 🎚️ hangerő-automáció Graph Editorral (value/time görbe, bezier) */}
          <Text style={styles.note}>{t('panels.audio.volumeAutomation')}</Text>
          <KeyframeGraphEditor
            keyframes={clip.keyframes?.volume ?? []}
            duration={clip.duration}
            min={0}
            max={1}
            fallback={clip.volume}
            playhead={clamp(playhead - clip.start, 0, clip.duration)}
            onChange={(next) =>
              updateClip(clip.id, {
                keyframes: { ...clip.keyframes, volume: next.length > 0 ? next : undefined },
              })
            }
            onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <Text style={styles.note}>
            {t('panels.audio.mixHint')}
          </Text>
        </PanelSection>

        {/* 🎛️ Pro audio-effektek — a renderben alkalmazódnak (előnézet közelít) */}
        <PanelSection title={t('panels.audio.fxTitle')}>
          <Stepper
            label={t('panels.audio.fxHighpass')}
            value={fx.highpass ? `${fx.highpass} Hz` : t('common.off')}
            onDec={() => setFx({ highpass: (fx.highpass ?? 0) <= 60 ? 0 : (fx.highpass ?? 0) - 20 })}
            onInc={() => setFx({ highpass: (fx.highpass ?? 0) === 0 ? 60 : Math.min(300, (fx.highpass ?? 0) + 20) })}
          />
          <Stepper
            label={t('panels.audio.fxLowpass')}
            value={fx.lowpass ? `${Math.round(fx.lowpass / 1000)} kHz` : t('common.off')}
            onDec={() => setFx({ lowpass: (fx.lowpass ?? 0) === 0 ? 16000 : Math.max(2000, (fx.lowpass ?? 0) - 2000) })}
            onInc={() => setFx({ lowpass: (fx.lowpass ?? 0) === 0 || (fx.lowpass ?? 0) >= 16000 ? 0 : (fx.lowpass ?? 0) + 2000 })}
          />
          <Stepper
            label={t('panels.audio.fxEqLow')}
            value={`${eq.low > 0 ? '+' : ''}${eq.low} dB`}
            onDec={() => setEq({ low: Math.max(-12, eq.low - 3) })}
            onInc={() => setEq({ low: Math.min(12, eq.low + 3) })}
          />
          <Stepper
            label={t('panels.audio.fxEqMid')}
            value={`${eq.mid > 0 ? '+' : ''}${eq.mid} dB`}
            onDec={() => setEq({ mid: Math.max(-12, eq.mid - 3) })}
            onInc={() => setEq({ mid: Math.min(12, eq.mid + 3) })}
          />
          <Stepper
            label={t('panels.audio.fxEqHigh')}
            value={`${eq.high > 0 ? '+' : ''}${eq.high} dB`}
            onDec={() => setEq({ high: Math.max(-12, eq.high - 3) })}
            onInc={() => setEq({ high: Math.min(12, eq.high + 3) })}
          />
          <Stepper
            label={t('panels.audio.fxReverb')}
            value={`${Math.round((fx.reverb ?? 0) * 100)}%`}
            onDec={() => setFx({ reverb: Math.max(0, round1((fx.reverb ?? 0) - 0.2)) })}
            onInc={() => setFx({ reverb: Math.min(1, round1((fx.reverb ?? 0) + 0.2)) })}
          />
          <Stepper
            label={t('panels.audio.fxDelay')}
            value={`${Math.round((fx.delay ?? 0) * 100)}%`}
            onDec={() => setFx({ delay: Math.max(0, round1((fx.delay ?? 0) - 0.2)) })}
            onInc={() => setFx({ delay: Math.min(1, round1((fx.delay ?? 0) + 0.2)) })}
          />
          <View style={styles.chipRow}>
            <Chip label={t('panels.audio.fxDenoise')} active={fx.denoise === true} onPress={() => setFx({ denoise: !fx.denoise })} />
            <Chip label={t('panels.audio.fxDeEsser')} active={fx.deEsser === true} onPress={() => setFx({ deEsser: !fx.deEsser })} />
            <Chip label={t('panels.audio.fxCompressor')} active={fx.compressor === true} onPress={() => setFx({ compressor: !fx.compressor })} />
            <Chip label={t('panels.audio.fxLimiter')} active={fx.limiter === true} onPress={() => setFx({ limiter: !fx.limiter })} />
            <Chip label={t('panels.audio.fxNormalize')} active={fx.normalize === true} onPress={() => setFx({ normalize: !fx.normalize })} />
          </View>
          <Text style={styles.note}>{t('panels.audio.fxHint')}</Text>
        </PanelSection>
        </>
      ) : (
        <Text style={styles.note}>
          {t('panels.audio.emptyHint')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ttsInput: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  ttsBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  trackList: {
    gap: 6,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  trackIcon: {
    fontSize: 14,
  },
  trackName: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  trackDuration: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  matchToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: 6,
  },
  matchToggleOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  matchToggleText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  matchToggleTextOn: {
    color: palette.accent,
  },
  matchBadge: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
