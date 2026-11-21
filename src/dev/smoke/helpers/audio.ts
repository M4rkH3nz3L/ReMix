/** 🧪 Füstteszt — hang-próbafájlok (szinusz WAV, 30 perces forrás) és a valódi felvevő-hám. (Áthelyezve: shared; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { useRef, useEffect } from 'react';
import { type AudioRecorder, useAudioRecorder, RecordingPresets } from 'expo-audio';
import { wavHeader16 } from '@/lib/offlineMix';
import { stopVoiceRecording, voiceoverClip } from '@/lib/voiceRecording';
import { useFinishRecordingOnLeave } from '@/hooks/useFinishRecordingOnLeave';
import { makeId } from '@/lib/id';
import { useEditorStore } from '@/store/editorStore';

export const AUDIO_KILL_ID = 'prj_smoke_audiokill';
/** 30 perces mono 16 bites hangfájl (30 mp-enként lépő hangmagasság), egyszer generálva */
export function longToneFile(): File {
  const SR = 44100;
  const SEC = 30 * 60;
  const value = (i: number) => 0.3 * Math.sin((2 * Math.PI * (220 + 5 * Math.floor(i / (30 * SR))) * i) / SR);
  const src = new File(Paths.document, 'smoke_long_30min.wav');
  if (!src.exists) {
    src.create();
    const h = src.open();
    h.writeBytes(wavHeader16(SEC * SR, 1, SR));
    const CH = SR * 10;
    for (let a = 0; a < SEC * SR; a += CH) {
      const n = Math.min(CH, SEC * SR - a);
      const buf = new Int16Array(n);
      for (let i = 0; i < n; i++) buf[i] = Math.round(value(a + i) * 32767);
      h.writeBytes(new Uint8Array(buf.buffer));
    }
    h.close();
  }
  return src;
}
export type RecordHandle = { recorder: AudioRecorder; finish: { current: () => Promise<void> } };
/** a valódi `useAudioRecorder` + a közös felvétel-út, ahogy a Hang panel és a stúdió használja */
export function RecordHarness({ onReady, start, onLowSpace }: { onReady: (h: RecordHandle) => void; start: () => number; onLowSpace?: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const finish = useRef<() => Promise<void>>(async () => {});
  useFinishRecordingOnLeave(recorder, finish, onLowSpace);
  finish.current = async () => {
    const { uri, seconds } = await stopVoiceRecording(recorder);
    if (uri) {
      const { clip, asset } = voiceoverClip(uri, seconds, start(), 30, 'smoke felvétel', makeId);
      useEditorStore.getState().addClip('voiceover', clip, asset);
    }
  };
  useEffect(() => {
    onReady({ recorder, finish });
  }, [onReady, recorder]);
  return null;
}
/** 16 bites mono szinusz WAV; a hang-mérés valódi fájlon megy, fixture nélkül. */
export function toneWav(name: string, seconds: number): string {
  const rate = 44100;
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16000), true);
  }
  const file = new File(Paths.document, name);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return file.uri;
}
