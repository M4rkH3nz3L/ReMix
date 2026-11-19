/** 🧪 A füstteszt-fázisok közös segédei (a korábbi src/lib/imageSmoke.tsx-ből). */
import { AlphaType, ColorType, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { RecordingPresets, useAudioRecorder, type AudioRecorder } from 'expo-audio';
import { cloudAvailable , serverHost } from '@/lib/backend';
import '@/lib/dspNativeClient';
import { wavHeader16 } from '@/lib/offlineMix';
import { stopVoiceRecording, voiceoverClip } from '@/lib/voiceRecording';
import { useFinishRecordingOnLeave } from '@/hooks/useFinishRecordingOnLeave';
import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { projectMediaDir } from '@/lib/projectFolderClient';
import Constants from 'expo-constants';
import { listProjects, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';
import { tempProject } from './phases15';

export type Log = (ok: boolean | null, name: string, detail?: string) => void;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function decode(uri: string): Promise<SkImage> {
  const bytes = await new File(uri).bytes();
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!img) {
    throw new Error(`nem dekódolható: ${uri}`);
  }
  return img;
}
export function pixel(img: SkImage, x: number, y: number): number[] {
  const px = img.readPixels(x, y, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return px ? [...px] : [];
}
/** átlátszó vászon, közepén piros négyzet — az alfa-megőrzés próbájához */
export function alphaImage(format: ImageFormat, ext: string): string {
  const surface = Skia.Surface.MakeOffscreen(64, 64)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#ff0000'));
  surface.getCanvas().drawRect(Skia.XYWHRect(20, 20, 24, 24), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_alpha_${Date.now().toString(36)}.${ext}`);
  file.write(surface.makeImageSnapshot().encodeToBytes(format));
  return file.uri;
}
export function removeFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    /* takarítás — best-effort */
  }
}
export function testDoc(extra: Partial<ImageDoc> = {}): ImageDoc {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 1080, height: 1080 });
  // üres, átlátszó vászon: a háttér-réteg nélkül látszik, ha a capture hozza a keretet/hátteret
  const doc: ImageDoc = { ...base, layers: [], ...extra };
  const shape = { kind: 'shape', id: makeId('lyr'), shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff0000' } as ShapeLayer;
  return addLayer(doc, shape as ImageLayer);
}
/** Mérési segéd: két kép eltérése rácspontonként (alfa + szín, ahol mindkettő fedő). */
export function gridDiff(a: SkImage, b: SkImage, size: number, stop: number): { bad: number; total: number } {
  let bad = 0;
  let total = 0;
  for (let y = 8; y < stop; y += 12) {
    for (let x = 8; x < size; x += 12) {
      total += 1;
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      const color = p[3] > 128 && q[3] > 128 ? Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - q[k]))) : 0;
      if (Math.abs(p[3] - q[3]) > 70 || color > 40) {
        bad += 1;
      }
    }
  }
  return { bad, total };
}
export function meanDiff(a: SkImage, b: SkImage, size: number, stop: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 5; y < stop; y += 7) {
    for (let x = 5; x < size - 5; x += 7) {
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      sum += (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
      n += 1;
    }
  }
  return sum / n;
}
export function spread(a: SkImage, x0: number, y0: number, n: number): number {
  const v: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v.push(pixel(a, x0 + x, y0 + y)[1]);
  const m = v.reduce((p, c) => p + c, 0) / v.length;
  return Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length);
}
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
/** van-e felhő ebben a buildben (dev: a helyi worker; release: csak beállított `EXPO_PUBLIC_CLOUD_URL`-lel) */
export function cloudInThisBuild(): boolean {
  return cloudAvailable();
}
/** 🧪 a Mac próbafájl-szervere (8799) a Metro címén — Wi-Fin és USB-n (169.254) is */
export function smokeFileHost(): string {
  // release-mérésnél nincs Metro-cím: a build idején megadott Mac-cím
  const fixed = process.env.EXPO_PUBLIC_SMOKE_HOST?.trim();
  return `http://${fixed || serverHost(undefined, Constants.expoConfig?.hostUri, true)}:8799`;
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
/** Ideiglenes projekt a tablet-elrendezés megnézéséhez (`kill2` törli). */
export async function tabletProject(id: string): Promise<string> {
  await saveProject(tempProject(id));
  return id;
}
export async function firstImageProjectId(): Promise<string | null> {
  const all = await listProjects();
  return all.find((p) => p.kind === 'image')?.id ?? null;
}
