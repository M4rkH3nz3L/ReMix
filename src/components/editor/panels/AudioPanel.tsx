import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { setChannelKeyframe } from '@/lib/keyframes';
import { pickAudio } from '@/lib/media';
import { downloadTrack, fetchSoundLibrary } from '@/lib/render';
import type { LibraryTrack } from '@/lib/render';
import { fetchTtsVoices, generateTts, type TtsVoice } from '@/lib/tts';
import { clamp, formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/**
 * Hang-panel: voiceover-felvétel közvetlenül az appból + a kijelölt hangklip
 * keverése (hangerő, fade in/out).
 */
export function AudioPanel({ clip }: { clip: AudioClip | null }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const addClip = useEditorStore((s) => s.addClip);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recordStartPlayhead = useRef(0);

  const [library, setLibrary] = useState<LibraryTrack[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);

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
        addAudioClip(uri, 'AI-hang', duration, 'local', 'voiceover');
        setTtsText('');
      })
      .catch((err: Error) => Alert.alert('AI-hang', err.message))
      .finally(() => setTtsBusy(false));
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
      .catch(() => Alert.alert('Hiba', 'A hang letöltése nem sikerült.'))
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
            label: 'Voiceover',
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
            name: 'Voiceover',
            duration: seconds,
          }
        );
      }
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Nincs mikrofon-engedély', 'A voiceoverhez engedélyezd a mikrofont.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recordStartPlayhead.current = useEditorStore.getState().playhead;
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  return (
    <View>
      <PanelSection title="Hang-könyvtár">
        {library === null && !libraryError ? (
          <Text style={styles.note}>Könyvtár betöltése…</Text>
        ) : libraryError ? (
          <Text style={styles.note}>
            A hang-könyvtárhoz indítsd el a workert (cd server && npm start). Saját
            zenéidet a server/music mappába teheted.
          </Text>
        ) : (
          <View style={styles.trackList}>
            {library!.map((track) => (
              <Pressable
                key={track.id}
                style={styles.trackRow}
                onPress={() => addFromLibrary(track)}
              >
                <Text style={styles.trackIcon}>{track.kind === 'music' ? '🎵' : '💥'}</Text>
                <Text style={styles.trackName} numberOfLines={1}>
                  {busyTrack === track.id ? 'Letöltés…' : track.name}
                </Text>
                <Text style={styles.trackDuration}>{track.duration.toFixed(1)} mp</Text>
              </Pressable>
            ))}
            <Text style={styles.note}>
              Koppints a hozzáadáshoz — a lejátszófejnél kerül a hang-sávra. Saját
              zenék: server/music mappa.
            </Text>
          </View>
        )}
      </PanelSection>

      <PanelSection title="Saját fájl">
        <PrimaryButton
          icon="folder-open-outline"
          label="Zene importálása fájlból"
          onPress={() => {
            importOwn().catch(() => Alert.alert('Hiba', 'Az import nem sikerült.'));
          }}
        />
      </PanelSection>

      <PanelSection title="Voiceover">
        <PrimaryButton
          icon={recorderState.isRecording ? 'stop' : 'mic'}
          label={
            recorderState.isRecording
              ? `Felvétel leállítása (${formatTime(recorderState.durationMillis / 1000)})`
              : 'Felvétel indítása a lejátszófejtől'
          }
          onPress={() => {
            toggleRecord().catch(() => {
              Alert.alert('Hiba', 'A felvétel nem indult el.');
            });
          }}
        />
        <Text style={styles.note}>
          A felvétel a lejátszófej pozíciójától kerül a hang-sávra.
        </Text>
      </PanelSection>

      <PanelSection title="🗣️ AI-hang (szöveg → beszéd)">
        {ttsAvailable === false ? (
          <Text style={styles.note}>
            A dev-worker nem érhető el (macOS). Indítsd: cd server && npm start — utána a
            beírt szövegből hang készül, felvétel nélkül.
          </Text>
        ) : (
          <>
            <TextInput
              value={ttsText}
              onChangeText={setTtsText}
              placeholder="Írd be a szöveget, amit felolvassak…"
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
                <Text style={styles.note}>Hang készül…</Text>
              </View>
            ) : (
              <PrimaryButton icon="sparkles" label="Hang generálása" onPress={generateVoice} />
            )}
            <Text style={styles.note}>
              A hang a lejátszófejnél kerül a voiceover-sávra — utána a Voice Studio
              (✨ Enhance) is ráhúzható.
            </Text>
          </>
        )}
      </PanelSection>

      {clip ? (
        <PanelSection title={`Keverés — ${clip.label}`}>
          <Stepper
            label="Hangerő"
            value={`${Math.round(clip.volume * 100)}%`}
            onDec={() => updateClip(clip.id, { volume: clamp(clip.volume - 0.1, 0, 1) })}
            onInc={() => updateClip(clip.id, { volume: clamp(clip.volume + 0.1, 0, 1) })}
          />
          <Stepper
            label="Fade in"
            value={`${clip.fadeIn.toFixed(1)} mp`}
            onDec={() => updateClip(clip.id, { fadeIn: clamp(clip.fadeIn - 0.5, 0, 10) })}
            onInc={() => updateClip(clip.id, { fadeIn: clamp(clip.fadeIn + 0.5, 0, 10) })}
          />
          <Stepper
            label="Fade out"
            value={`${clip.fadeOut.toFixed(1)} mp`}
            onDec={() => updateClip(clip.id, { fadeOut: clamp(clip.fadeOut - 0.5, 0, 10) })}
            onInc={() => updateClip(clip.id, { fadeOut: clamp(clip.fadeOut + 0.5, 0, 10) })}
          />
          <View style={styles.chipRow}>
            {clip.source === 'voiceover' ? (
              <>
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
              </>
            ) : (
              <Chip
                label="🎚️ Halkítás beszéd alatt"
                active={clip.autoDuck === true}
                onPress={() => updateClip(clip.id, { autoDuck: !clip.autoDuck })}
              />
            )}
          </View>
          <View style={styles.chipRow}>
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
          <Text style={styles.note}>
            A Voice Studio (zajszűrés + kompresszor + loudness) és a ducking a
            renderelt MP4-ben érvényesül. Hangerő-automáció: állítsd a hangerőt,
            állj a playheaddel a kívánt pontra, és üsd le a ◆-t — a hangerő a
            kulcskockák közt átúszik (előnézetben és renderben is).
          </Text>
        </PanelSection>
      ) : (
        <Text style={styles.note}>
          Jelölj ki egy hangklipet az idővonalon a keveréshez, vagy adj hozzá zenét a
          „Zene” gombbal.
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
});
