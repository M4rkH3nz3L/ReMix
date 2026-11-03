import { sampleChannel } from '@/lib/keyframes';
import { projectDuration } from '@/lib/projectUtils';
import type { AudioClip, Keyframe, Project, TrackType } from '@/types/project';

/**
 * 🎧📱 Telefonos (offline) hang-keverés — PRO-AUDIO A26: a Free felhasználó szerver nélkül
 * exportálhat. Pure és expo-mentes: a dekódolt PCM-ből a szerveres render szabályaival kever
 * (`server/render.js`): forrás-ablak `trimIn`-től, hangerő-automáció (ugyanaz a görbe, mint az
 * élő lejátszóé), fade be/ki szorzatként, lineáris balansz (bal = 1 − max(0, pan), jobb =
 * 1 − max(0, −pan)), sáv- és master-erősítés, összegzés normalizálás nélkül. A szerver
 * effektjei (Pro) itt nincsenek: ezeket az `unsupported` sorolja fel.
 */

const AUDIO_TRACKS: TrackType[] = ['music', 'voiceover', 'sfx'];
export const OFFLINE_SAMPLE_RATE = 44100;

export interface DecodedSource {
  channels: Float32Array[];
  sampleRate: number;
}

export interface OfflineMixClip {
  uri: string;
  start: number;
  duration: number;
  trimIn: number;
  volume: number;
  volumeKf?: Keyframe[];
  fadeIn: number;
  fadeOut: number;
  pan: number;
  panKf?: Keyframe[];
  /** sáv- × master-erősítés */
  gain: number;
}

export type OfflineUnsupported = 'effects' | 'voiceEnhance' | 'deReverb' | 'autoDuck' | 'master';

export interface OfflineMixPlan {
  duration: number;
  clips: OfflineMixClip[];
  unsupported: OfflineUnsupported[];
}

/** A keverés terve a (`mixForExport` utáni) projektből. */
export function offlineMixPlan(project: Project): OfflineMixPlan {
  const clips: OfflineMixClip[] = [];
  const unsupported = new Set<OfflineUnsupported>();
  for (const track of project.tracks) {
    if (!AUDIO_TRACKS.includes(track.type)) {
      continue;
    }
    const gain = project.trackMix?.[track.type]?.gain ?? 1;
    for (const c of track.clips) {
      if (c.kind !== 'audio') {
        continue;
      }
      const clip = c as AudioClip;
      if (clip.audioFx && Object.values(clip.audioFx).some((v) => v)) unsupported.add('effects');
      if (clip.voiceEnhance) unsupported.add('voiceEnhance');
      if (clip.deReverb) unsupported.add('deReverb');
      if (clip.autoDuck) unsupported.add('autoDuck');
      clips.push({
        uri: clip.uri,
        start: clip.start,
        duration: clip.duration,
        trimIn: clip.trimIn ?? 0,
        volume: clip.volume,
        volumeKf: clip.keyframes?.volume,
        fadeIn: clip.fadeIn ?? 0,
        fadeOut: clip.fadeOut ?? 0,
        pan: clip.pan ?? 0,
        panKf: clip.keyframes?.pan,
        gain,
      });
    }
  }
  if (project.audioMaster) unsupported.add('master');
  return { duration: projectDuration(project), clips, unsupported: [...unsupported] };
}

/** A klip-helyi `t` időpont erősítése (hangerő-automáció × fade be × fade ki × sáv). */
export function clipGainAt(clip: OfflineMixClip, t: number): number {
  return sampleChannel(clip.volumeKf, t, clip.volume) * clip.gain * fadeAt(clip, t);
}

function fadeAt(clip: OfflineMixClip, t: number): number {
  let g = 1;
  if (clip.fadeIn > 0) {
    g *= Math.min(1, Math.max(0, t / clip.fadeIn));
  }
  if (clip.fadeOut > 0) {
    g *= Math.min(1, Math.max(0, (clip.duration - t) / clip.fadeOut));
  }
  return g;
}

/** Lineáris balansz (a szerver `panFilter`/`panChain` törvénye). */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  return [1 - Math.max(0, p), 1 - Math.max(0, -p)];
}

// a hangerő-automáció ennyi mintánként lép, a klip elejétől — mint a szerver 64 mintás
// kereteiben (`asetnsamples`); a fade és az automatikus pan mintánként számolódik
const BLOCK = 64;

/**
 * A keverés a `[fromSample, toSample)` tartományra (darabokban hívható — a hosszú export
 * így nem fagyasztja a felületet). Kimenet: sztereó, `OFFLINE_SAMPLE_RATE`-en.
 */
export function mixRange(
  plan: OfflineMixPlan,
  sources: Map<string, DecodedSource>,
  out: [Float32Array, Float32Array],
  fromSample: number,
  toSample: number,
  monoGain = 1
): void {
  const sr = OFFLINE_SAMPLE_RATE;
  for (const clip of plan.clips) {
    const src = sources.get(clip.uri);
    if (!src || src.channels.length === 0) {
      continue;
    }
    const left = src.channels[0];
    const right = src.channels[1] ?? src.channels[0];
    const mono = src.channels.length === 1;
    const clipFrom = Math.round(clip.start * sr);
    const clipTo = clipFrom + Math.round(clip.duration * sr);
    const a = Math.max(fromSample, clipFrom);
    const b = Math.min(toSample, clipTo);
    const srcOffset = Math.round(clip.trimIn * src.sampleRate) - clipFrom;
    const staticPan = !clip.panKf || clip.panKf.length === 0 ? panGains(clip.pan) : null;
    const hasFade = clip.fadeIn > 0 || clip.fadeOut > 0;
    // a blokk-rács a klip elejéhez igazodik (a darabos hívás se tolja el)
    const firstBlock = clipFrom + Math.floor((a - clipFrom) / BLOCK) * BLOCK;
    for (let blockStart = firstBlock; blockStart < b; blockStart += BLOCK) {
      const blockEnd = Math.min(b, blockStart + BLOCK);
      const level = sampleChannel(clip.volumeKf, (blockStart - clipFrom) / sr, clip.volume) * clip.gain * (mono ? monoGain : 1);
      for (let i = Math.max(a, blockStart); i < blockEnd; i++) {
        const s = i + srcOffset;
        if (s < 0 || s >= left.length) {
          continue;
        }
        const t = (i - clipFrom) / sr;
        const g = hasFade ? level * fadeAt(clip, t) : level;
        const [lg, rg] = staticPan ?? panGains(sampleChannel(clip.panKf, t, clip.pan));
        out[0][i - fromSample] += left[s] * g * lg;
        out[1][i - fromSample] += right[s] * g * rg;
      }
    }
  }
}

/** 16 bites PCM WAV fejléc (`frames` minta csatornánként). */
export function wavHeader16(frames: number, channels: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  const data = frames * channels * 2;
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  return bytes;
}

/**
 * A lebegőpontos minták 16 bites PCM-ként, TPDF-ditherrel (mint a szerveres WAV-export).
 * Darabonként hívható; a `rand` cserélhető (teszthez determinisztikus).
 */
export function pcm16(channels: Float32Array[], rand: () => number = Math.random): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const bytes = new Uint8Array(n * ch * 2);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const dither = (rand() - rand()) / 32768;
      const v = Math.round((channels[c][i] + dither) * 32767);
      view.setInt16(at, Math.max(-32768, Math.min(32767, v)), true);
      at += 2;
    }
  }
  return bytes;
}

/** Teljes WAV egyben (rövid mixhez és teszthez). */
export function encodeWav16(channels: Float32Array[], sampleRate: number, rand: () => number = Math.random): Uint8Array {
  const head = wavHeader16(channels[0]?.length ?? 0, channels.length, sampleRate);
  const body = pcm16(channels, rand);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}
