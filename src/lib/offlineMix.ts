import { audioSpeedOf, continuesInSource } from '@/lib/audioTrim';
import { sampleChannel } from '@/lib/keyframes';
import { projectDuration } from '@/lib/projectUtils';
import { buildFxChain, FX_WARMUP, fxActive, fxUnsupported, NORMALIZE_LUFS, runChain, voiceFx, type FxState } from '@/lib/audioDsp';
import { integratedLoudness } from '@/lib/loudness';
import type { AudioClip, AudioFx, Clip, Keyframe, Project, TrackType, VideoClip } from '@/types/project';

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
/** kattogásmentes vágás: mikro-fade a klip szélén (a szerver `EDGE_FADE_SEC`-je; szerződés-teszt) */
export const EDGE_FADE_SEC = 0.01; // 44,1 és 48 kHz-en is egész mintaszám (441 / 480)
const EDGE_EPS = 1e-4;

/**
 * A klip ténylegesen alkalmazott fade-jei: a felhasználói fade, ennek hiányában 5 ms-os
 * mikro-fade — kivéve a kettévágott klip illesztését (ugyanaz a forrás folytatódik).
 * A szerver `edgeFades`-ének tükre.
 */
export function edgeFades(clips: AudioClip[]): Map<string, { in: number; out: number }> {
  const out = new Map<string, { in: number; out: number }>();
  // ⏩⏪ a forrásban is folytatódó szomszéd (sebesség és irány szerint — a szerver tükre)
  for (const c of clips) {
    const joinedBefore = clips.some(
      (p) => p !== c && p.uri === c.uri && Math.abs(p.start + p.duration - c.start) < EDGE_EPS && continuesInSource(p, c, EDGE_EPS)
    );
    const joinedAfter = clips.some(
      (n) => n !== c && n.uri === c.uri && Math.abs(c.start + c.duration - n.start) < EDGE_EPS && continuesInSource(c, n, EDGE_EPS)
    );
    out.set(c.id, {
      in: c.fadeIn > 0 ? c.fadeIn : joinedBefore ? 0 : EDGE_FADE_SEC,
      out: c.fadeOut > 0 ? c.fadeOut : joinedAfter ? 0 : EDGE_FADE_SEC,
    });
  }
  return out;
}

export interface DecodedSource {
  channels: Float32Array[];
  sampleRate: number;
}

export interface OfflineMixClip {
  /** a sáv, amin a klip ül (a sávonkénti szintmérőhöz) */
  track: TrackType;
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
  /** a klip azonosítója (az effekt-állapot kulcsa a darabos keverésben) */
  id: string;
  /** 🎛️ a klip effektjei (a közös DSP: `audioDsp.ts`) */
  fx?: AudioFx;
  /** ⏩ forrás-mp / idővonal-mp (hangmagasság-tartással); 1 = nincs nyújtás */
  speed: number;
  /** ⏪ a forrás-ablak visszafelé szól (a videóklip `reversed`-je) */
  reversed: boolean;
  /** 🎚️ hangmagasság-eltolás félhangban (a hossz marad); 0 = nincs */
  pitch: number;
  /** 📏 a normalizálás előmenetben mért erősítése (`withNormalizeGains`) */
  normGain?: number;
  /** 🏚️ visszhang-csökkentés (a lánc elején) */
  deReverb?: boolean;
}

export type OfflineUnsupported = 'effects' | 'voiceEnhance' | 'deReverb' | 'autoDuck' | 'master' | 'videoSpeed';

export interface OfflineMixPlan {
  duration: number;
  clips: OfflineMixClip[];
  unsupported: OfflineUnsupported[];
}

/** a klip hangmagasság-eltolása félhangban, a szerverrel azonosan ±12-re szorítva */
function pitchOf(semitones: number | undefined): number {
  return Math.max(-12, Math.min(12, Math.round(semitones ?? 0)));
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
    const audio = track.clips.filter((c): c is AudioClip => c.kind === 'audio');
    const fades = edgeFades(audio);
    for (const clip of audio) {
      // 🎛️ a közös DSP-ben már megvalósított effektek szólnak; a többi még csak a szerveren
      if (fxUnsupported(clip.audioFx)) unsupported.add('effects');
      if (clip.autoDuck) unsupported.add('autoDuck');
      // 🎙️ hangjavítás / visszhang-csökkentés: a közös DSP elemeiből (`voiceFx`)
      const fx = voiceFx(clip.audioFx, !!clip.voiceEnhance, !!clip.deReverb);
      const main: OfflineMixClip = {
        id: clip.id,
        ...(fxActive(fx) || clip.deReverb ? { fx: fx ?? {} } : {}),
        ...(clip.deReverb ? { deReverb: true } : {}),
        track: track.type,
        uri: clip.uri,
        start: clip.start,
        duration: clip.duration,
        trimIn: clip.trimIn ?? 0,
        volume: clip.volume,
        volumeKf: clip.keyframes?.volume,
        fadeIn: fades.get(clip.id)?.in ?? 0,
        fadeOut: fades.get(clip.id)?.out ?? 0,
        pan: clip.pan ?? 0,
        panKf: clip.keyframes?.pan,
        gain,
        speed: audioSpeedOf(clip),
        reversed: !!clip.reversed,
        pitch: pitchOf(clip.audioFx?.pitchSemitones),
      };
      clips.push(main);
      // 🎵 harmónia (a szerver tükre): a klip MELLÉ egy eltolt, 0,7-szeres másodhang, a felhasználói
      // fade-ekkel; a teljes eltolás (klip + harmónia) ±12 félhangra szorítva
      const harm = Math.round(clip.audioFx?.harmony ?? 0);
      if (harm !== 0) {
        clips.push({
          ...main,
          id: `${clip.id}#harmonia`,
          pitch: pitchOf(Math.round(clip.audioFx?.pitchSemitones ?? 0) + harm),
          volume: main.volume * 0.7,
          volumeKf: main.volumeKf?.map((k) => ({ ...k, value: k.value * 0.7 })),
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
        });
      }
    }
  }
  clips.push(...videoAudioClips(project, unsupported));
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
  monoGain = 1,
  fxState: Map<string, FxState> = new Map()
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
    // 🎛️ effektek (a szerver sorrendjében: a pan és a hangerő ELŐTT): a forrás-szakasz előbb a
    // láncon megy át. Az állapot szeletről szeletre megmarad; ugrás után a lánc a megelőző
    // hanggal bejáratódik (különben az ugrás pontján kattanna).
    let fxL: Float32Array | null = null;
    let fxR: Float32Array | null = null;
    if (clip.fx && b > a) {
      const read = (from: number, to: number): [Float32Array, Float32Array] => {
        const l = new Float32Array(to - from);
        const r = new Float32Array(to - from);
        for (let i = from; i < to; i++) {
          const s = i + srcOffset;
          if (s >= 0 && s < left.length) {
            l[i - from] = left[s];
            r[i - from] = right[s];
          }
        }
        return [l, r];
      };
      const key = `${clip.id}|${JSON.stringify(clip.fx)}|${clip.normGain ?? 1}|${clip.deReverb ? 'dr' : ''}`;
      let st = fxState.get(key);
      if (!st || st.next !== a) {
        st = { chain: buildFxChain(clip.fx, sr, clip.normGain, clip.deReverb), next: a };
        const w0 = Math.max(clipFrom, a - FX_WARMUP);
        if (w0 < a) {
          const [wl, wr] = read(w0, a);
          runChain(st.chain, wl, wr, w0 - clipFrom);
        }
      }
      [fxL, fxR] = read(a, b);
      runChain(st.chain, fxL, fxR, a - clipFrom);
      st.next = b;
      fxState.set(key, st);
    }
    // a blokk-rács a klip elejéhez igazodik (a darabos hívás se tolja el)
    const firstBlock = clipFrom + Math.floor((a - clipFrom) / BLOCK) * BLOCK;
    for (let blockStart = firstBlock; blockStart < b; blockStart += BLOCK) {
      const blockEnd = Math.min(b, blockStart + BLOCK);
      const level = sampleChannel(clip.volumeKf, (blockStart - clipFrom) / sr, clip.volume) * clip.gain * (mono ? monoGain : 1);
      for (let i = Math.max(a, blockStart); i < blockEnd; i++) {
        const s = i + srcOffset;
        if (!fxL && (s < 0 || s >= left.length)) {
          continue;
        }
        const t = (i - clipFrom) / sr;
        const g = hasFade ? level * fadeAt(clip, t) : level;
        const [lg, rg] = staticPan ?? panGains(sampleChannel(clip.panKf, t, clip.pan));
        const xl = fxL ? fxL[i - a] : left[s];
        const xr = fxR ? fxR[i - a] : right[s];
        out[0][i - fromSample] += xl * g * lg;
        out[1][i - fromSample] += xr * g * rg;
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

/**
 * 🎬 A videóklipek hangja (PRO-AUDIO 17/20) — a szerver `visualSegments` + videó-hang
 * láncának tükre: a vizuális sáv nem átfedő szakaszokra bomlik (átfedésnél a később kezdődő
 * klip nyer, a képklip is takar), a klip hangja csak a látható szakaszán szól, a hangerő-
 * automáció a klip saját idejében fut, fade és sáv-erősítés nincs. ⏩⏪ A gyorsított vagy
 * visszafelé játszott klip szakasza `speed`/`reversed`-del jön: a kliens előbb kivágja,
 * megfordítja és hangmagasság-tartással nyújtja (`stretchJobs`), mint a szerver areverse/atempo-ja.
 */
export function videoAudioClips(project: Project, _unsupported: Set<OfflineUnsupported>): OfflineMixClip[] {
  const visual = (project.tracks.find((t) => t.type === 'video')?.clips ?? [])
    .slice()
    .sort((a, b) => a.start - b.start || a.start + a.duration - (b.start + b.duration));
  const out: OfflineMixClip[] = [];
  let cursor = 0;
  for (let i = 0; i < visual.length; i++) {
    const clip: Clip = visual[i];
    const next = visual[i + 1];
    const visStart = Math.max(clip.start, cursor);
    const visEnd = Math.min(clip.start + clip.duration, next ? next.start : Infinity);
    if (visEnd <= visStart) {
      continue;
    }
    cursor = visEnd;
    if (clip.kind !== 'video') {
      continue;
    }
    const v = clip as VideoClip;
    const kf = v.keyframes?.volume;
    if (!(v.volume > 0 || (kf ?? []).some((k) => k.value > 0))) {
      continue;
    }
    const vfx = voiceFx(undefined, !!v.voiceEnhance, !!v.deReverb);
    const skip = visStart - v.start;
    const duration = visEnd - visStart;
    const speed = v.speed > 0 ? v.speed : 1;
    out.push({
      id: `${v.id}@${visStart}`,
      track: 'video',
      uri: v.uri,
      start: visStart,
      duration,
      // a szerver `segSourceWindow`-jának tükre: visszafelé a forrás-ablak a klip végéről indul
      trimIn: v.reversed ? v.trimIn + (v.duration - skip - duration) * speed : v.trimIn + skip * speed,
      volume: v.volume,
      // a szakasz a klip közepén is kezdődhet: a görbe a klip saját idejében fut
      volumeKf: kf?.map((k) => ({ ...k, time: k.time - skip })),
      fadeIn: 0,
      fadeOut: 0,
      pan: 0,
      gain: 1,
      speed,
      reversed: !!v.reversed,
      pitch: 0,
      ...(vfx ? { fx: vfx } : {}),
      ...(v.deReverb ? { deReverb: true } : {}),
    });
  }
  return out;
}

/**
 * ⏩⏪ Egy nyújtandó/megfordítandó forrás-szakasz: a kliens a dekódolt forrásból kivágja a
 * `[from, from + sourceSec)` ablakot, megfordítja (`reversed`), majd hangmagasság-tartással
 * `duration` hosszúra nyújtja — a kész szakasz `key` néven 1×-es forrásként kerül a keverőbe.
 */
export interface StretchJob {
  key: string;
  uri: string;
  from: number;
  sourceSec: number;
  duration: number;
  speed: number;
  reversed: boolean;
  /** 🎚️ hangmagasság-eltolás félhangban (a hossz marad) */
  pitch: number;
  /** 🧹 spektrális zajszűrés a kész szakaszon (`denoise.ts`) */
  denoise: boolean;
}

/**
 * A terv átírása: a gyorsított/megfordított klip a kész szakaszra hivatkozik (`trimIn` 0,
 * `speed` 1), így a `mixRange` változatlanul keveri. Az azonos szakaszok egy feladatot adnak.
 */
export function stretchJobs(plan: OfflineMixPlan): { jobs: StretchJob[]; plan: OfflineMixPlan } {
  const jobs = new Map<string, StretchJob>();
  const clips = plan.clips.map((c) => {
    const denoise = !!c.fx?.denoise;
    if (c.speed === 1 && !c.reversed && c.pitch === 0 && !denoise) {
      return c;
    }
    const key = `${c.uri}#${c.trimIn.toFixed(6)}|${c.duration.toFixed(6)}|${c.speed}|${c.reversed ? 'r' : 'f'}|${c.pitch}|${denoise ? 'dn' : ''}`;
    if (!jobs.has(key)) {
      jobs.set(key, { key, uri: c.uri, from: c.trimIn, sourceSec: c.duration * c.speed, duration: c.duration, speed: c.speed, reversed: c.reversed, pitch: c.pitch, denoise });
    }
    return { ...c, uri: key, trimIn: 0, speed: 1, reversed: false, pitch: 0 };
  });
  return { jobs: [...jobs.values()], plan: { ...plan, clips } };
}

/**
 * 📏 A normalizálás előmenete: a `normalize`-os klip ablakát a normalizálás ELŐTTI láncon
 * végigviszi, megméri az integrált hangosságát (BS.1770), és az erősítést a tervbe írja
 * (−16 LUFS-re). Az előnézet és az export is ezt futtatja (a `stretchJobs` után; a zajszűrés
 * addigra a szakaszon van).
 */
export function withNormalizeGains(plan: OfflineMixPlan, sources: Map<string, DecodedSource>): OfflineMixPlan {
  const sr = OFFLINE_SAMPLE_RATE;
  const clips = plan.clips.map((c) => {
    if (!c.fx?.normalize) {
      return c;
    }
    const src = sources.get(c.uri);
    if (!src || src.channels.length === 0) {
      return c;
    }
    const n = Math.round(c.duration * sr);
    const from = Math.round(c.trimIn * src.sampleRate);
    const [l, r] = sliceSource([src.channels[0], src.channels[1] ?? src.channels[0]], from, n, false);
    runChain(buildFxChain({ ...c.fx, normalize: false, limiter: false }, sr, 1, c.deReverb), l, r, 0);
    const lufs = integratedLoudness(l, r, sr);
    const normGain = Number.isFinite(lufs) ? Math.pow(10, (NORMALIZE_LUFS - lufs) / 20) : 1;
    return { ...c, normGain };
  });
  return { ...plan, clips };
}

/** A forrás `[from, from + n)` mintái csatornánként (a forráson túl csend), igény szerint fordítva. */
export function sliceSource(channels: Float32Array[], from: number, n: number, reversed: boolean): Float32Array[] {
  return channels.map((ch) => {
    const out = new Float32Array(n);
    const a = Math.max(0, from);
    const b = Math.min(ch.length, from + n);
    if (b > a) out.set(ch.subarray(a, b), a - from);
    if (reversed) out.reverse();
    return out;
  });
}

