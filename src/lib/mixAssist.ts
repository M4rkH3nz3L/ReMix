import { highpass, lowpass, type Biquad } from '@/lib/audioDsp';
import { masterPreset } from '@/lib/audioMaster';
import type { EditorCommand } from '@/lib/commands';
import { kWeighting } from '@/lib/loudness';
import type { AudioClip, AudioMaster, AudioMasterTarget, Project, TrackType } from '@/types/project';

/**
 * 🎚️🤖 Mixjavaslat és mastering-segéd — tiszta mag, a telefonon (offline). A sávonkénti (stem)
 * és a teljes keverés mérése: pillanatnyi hangosság (BS.1770, 400 ms-os ablak, 100 ms-os lépés),
 * a mély (< 60 Hz) / közép / magas (> 6 kHz) sáv energiája (4 pólusú szűrőkkel: a 100–200 Hz-es
 * beszéd-alaphang így nem számít „dübörgésnek”) és a csúcs. Ebből szabályok adnak
 * javaslatot — mindegyik konkrét, egy koppintással alkalmazható parancslista, indoklással.
 */

export interface TrackStats {
  /** integrált hangosság (LUFS, kapuzott) */
  lufs: number;
  /** pillanatnyi hangosság 100 ms-onként (LUFS; csendben −Infinity) */
  momentary: number[];
  /** a 100 ms-os blokkok saját hangossága (a szünetek zajához; digitális csendben −Infinity) */
  blocks: number[];
  /**
   * ugyanez a beszéd-sávban (80 Hz fölött): a dinamika-, zaj- és arány-szabályok ezt nézik, hogy a
   * mély dübörgés (aminek saját szabálya van) ne takarja el a halk mondatokat és a szünetek zaját
   */
  speech: { lufs: number; momentary: number[]; blocks: number[] };
  peak: number;
  /** a sávok energiája az egészhez képest (dB) */
  band: { low: number; mid: number; high: number };
}

const SUB_SEC = 0.1;
const LUFS = (p: number) => -0.691 + 10 * Math.log10(p);

export class TrackAnalyzer {
  private readonly sub: number;
  private readonly k: Biquad[];
  private readonly kS: Biquad[];
  private wS = 0;
  private readonly sE: number[] = [];
  private readonly lowF: Biquad[];
  private readonly highF: Biquad[];
  private wK = 0;
  private wN = 0;
  private readonly kE: number[] = [];
  private eLow = 0;
  private eHigh = 0;
  private eAll = 0;
  private peak = 0;

  constructor(sr: number) {
    this.sub = Math.round(SUB_SEC * sr);
    this.k = kWeighting(sr);
    this.kS = [highpass(80, sr), highpass(80, sr), ...kWeighting(sr)];
    this.lowF = [lowpass(60, sr), lowpass(60, sr)];
    this.highF = [highpass(6000, sr), highpass(6000, sr)];
  }

  push(l: Float32Array, r: Float32Array): void {
    const kl = Float32Array.from(l);
    const kr = Float32Array.from(r);
    for (const f of this.k) f.processStereo(kl, kr);
    const sl = Float32Array.from(l);
    const sr2 = Float32Array.from(r);
    for (const f of this.kS) f.processStereo(sl, sr2);
    const m = Float32Array.from(l, (v, i) => (v + r[i]) / 2);
    const lo = Float32Array.from(m);
    const hi = Float32Array.from(m);
    const loR = Float32Array.from(lo);
    const hiR = Float32Array.from(hi);
    for (const f of this.lowF) f.processStereo(lo, loR);
    for (const f of this.highF) f.processStereo(hi, hiR);
    for (let i = 0; i < l.length; i++) {
      const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      if (a > this.peak) this.peak = a;
      this.wK += kl[i] * kl[i] + kr[i] * kr[i];
      this.wS += sl[i] * sl[i] + sr2[i] * sr2[i];
      this.eAll += m[i] * m[i];
      this.eLow += lo[i] * lo[i];
      this.eHigh += hi[i] * hi[i];
      if (++this.wN === this.sub) {
        this.kE.push(this.wK);
        this.sE.push(this.wS);
        this.wK = 0;
        this.wS = 0;
        this.wN = 0;
      }
    }
  }

  /** BS.1770: a 100 ms-os energiákból pillanatnyi (400 ms) és kapuzott integrált hangosság */
  private loudness(e: number[]): { lufs: number; momentary: number[]; blocks: number[] } {
    const block = 4 * this.sub;
    const powers: number[] = [];
    for (let b = 0; b + 4 <= e.length; b++) powers.push((e[b] + e[b + 1] + e[b + 2] + e[b + 3]) / block);
    const momentary = powers.map((p) => (p > 0 ? LUFS(p) : -Infinity));
    const abs = powers.filter((p) => p > 0 && LUFS(p) > -70);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    let lufs = -Infinity;
    if (abs.length > 0) {
      const rel = abs.filter((p) => LUFS(p) > LUFS(mean(abs)) - 10);
      lufs = rel.length ? LUFS(mean(rel)) : -Infinity;
    }
    return { lufs, momentary, blocks: e.map((x) => (x > 1e-12 ? LUFS(x / this.sub) : -Infinity)) };
  }

  finish(): TrackStats {
    const { lufs, momentary, blocks } = this.loudness(this.kE);
    const speech = this.loudness(this.sE);
    const db = (e: number) => (this.eAll > 0 && e > 0 ? 10 * Math.log10(e / this.eAll) : -Infinity);
    const mid = Math.max(1e-30, this.eAll - this.eLow - this.eHigh);
    return { lufs, momentary, blocks, speech, peak: this.peak, band: { low: db(this.eLow), mid: db(mid), high: db(this.eHigh) } };
  }
}

/** a hangosság-tartomány (LRA-szerű): a hangos ablakok 95. és 10. percentilisének különbsége (LU) */
export function loudnessRange(m: number[]): number {
  const act = m.filter((x) => Number.isFinite(x) && x > -70).sort((a, b) => a - b);
  if (act.length < 10) return 0;
  const top = act[act.length - 1];
  const gated = act.filter((x) => x > top - 30);
  const q = (p: number) => gated[Math.min(gated.length - 1, Math.floor(p * gated.length))];
  return q(0.95) - q(0.1);
}

export interface MixSuggestion {
  key: 'duckMusic' | 'lowerMusic' | 'compressVoice' | 'highpassVoice' | 'deEssVoice' | 'denoiseVoice' | 'trackClipping';
  severity: 'error' | 'warn' | 'info';
  params: Record<string, string | number>;
  commands: EditorCommand[];
}

/** a beszéd és a zene ajánlott különbsége a beszédes részeken (LU) — beszéd alatti zenei ágy */
export const SPEECH_OVER_MUSIC_LU = 12;

const clipsOn = (p: Pick<Project, 'tracks'>, type: TrackType) =>
  (p.tracks.find((t) => t.type === type)?.clips ?? []).filter((c): c is AudioClip => c.kind === 'audio');
const energyMean = (xs: number[]) => {
  const fin = xs.filter(Number.isFinite);
  return fin.length ? 10 * Math.log10(fin.reduce((s, x) => s + Math.pow(10, x / 10), 0) / fin.length) : -Infinity;
};

/** a sávonkénti mérésből javaslatok (konkrét parancsokkal) */
export function mixSuggestions(project: Pick<Project, 'tracks' | 'trackMix'>, stats: Partial<Record<TrackType, TrackStats>>): MixSuggestion[] {
  const out: MixSuggestion[] = [];
  const voice = stats.voiceover;
  const voiceClips = clipsOn(project, 'voiceover');
  const allFx = (pred: (c: AudioClip) => boolean) => voiceClips.length > 0 && voiceClips.every(pred);
  const fxCmds = (patch: (c: AudioClip) => AudioClip['audioFx']): EditorCommand[] =>
    voiceClips.map((c) => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: { audioFx: patch(c) } }));

  // 1) zene a beszéd alatt
  const music = stats.music;
  if (voice && music && Number.isFinite(voice.speech.lufs)) {
    const speaking = voice.speech.momentary.map((x) => x > voice.speech.lufs - 10);
    const vDuring = energyMean(voice.speech.momentary.filter((_, i) => speaking[i]));
    const mDuring = energyMean(music.speech.momentary.filter((_, i) => speaking[i]));
    const gap = vDuring - mDuring;
    if (Number.isFinite(gap) && gap < SPEECH_OVER_MUSIC_LU - 3) {
      const musicClips = clipsOn(project, 'music');
      const ducked = musicClips.length > 0 && musicClips.every((c) => c.autoDuck);
      if (!ducked) {
        out.push({ key: 'duckMusic', severity: 'warn', params: { gap: Math.round(gap * 10) / 10, want: SPEECH_OVER_MUSIC_LU }, commands: musicClips.map((c) => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: { autoDuck: true } })) });
      } else {
        const cur = project.trackMix?.music?.gain ?? 1;
        const db = gap - SPEECH_OVER_MUSIC_LU;
        const g = Math.round(Math.max(0.05, Math.min(1, cur * Math.pow(10, db / 20))) * 1000) / 1000;
        out.push({ key: 'lowerMusic', severity: 'warn', params: { gap: Math.round(gap * 10) / 10, db: Math.round(db * 10) / 10 }, commands: [{ type: 'SET_TRACK_GAIN', trackType: 'music', gain: g }] });
      }
    }
  }

  if (voice && Number.isFinite(voice.lufs)) {
    // 2) a beszéd dinamikája
    const lra = loudnessRange(voice.speech.momentary);
    if (lra > 12 && !allFx((c) => !!c.audioFx?.compressor)) {
      out.push({ key: 'compressVoice', severity: 'warn', params: { lra: Math.round(lra * 10) / 10 }, commands: fxCmds((c) => ({ ...(c.audioFx ?? {}), compressor: true })) });
    }
    // 3) mély dübörgés
    if (voice.band.low > -15 && !allFx((c) => (c.audioFx?.highpass ?? 0) >= 60)) {
      out.push({ key: 'highpassVoice', severity: 'info', params: { db: Math.round(voice.band.low * 10) / 10 }, commands: fxCmds((c) => ({ ...(c.audioFx ?? {}), highpass: 80 })) });
    }
    // 4) sziszegés
    if (voice.band.high > -14 && !allFx((c) => !!c.audioFx?.deEsser)) {
      out.push({ key: 'deEssVoice', severity: 'info', params: { db: Math.round(voice.band.high * 10) / 10 }, commands: fxCmds((c) => ({ ...(c.audioFx ?? {}), deEsser: true })) });
    }
    // 5) zaj a szünetekben: a halkabb 15% (100 ms-os) blokk mediánja. A rövid digitális csend „nagyon
    // halk” szünet (tiszta felvétel); a klipek közti hosszú (≥ 1 s) csend nem a felvétel része — kimarad.
    const kept: number[] = [];
    const vb = voice.speech.blocks;
    for (let i = 0; i < vb.length; ) {
      if (Number.isFinite(vb[i])) {
        kept.push(vb[i++]);
        continue;
      }
      let j = i;
      while (j < vb.length && !Number.isFinite(vb[j])) j++;
      if (j - i < 10) for (let k = i; k < j; k++) kept.push(-Infinity);
      i = j;
    }
    kept.sort((a, b) => a - b);
    const quiet = kept.slice(0, Math.max(1, Math.floor(kept.length * 0.15)));
    const floor = quiet[Math.floor(quiet.length / 2)] ?? -Infinity;
    if (floor > -55 && floor < voice.speech.lufs - 10 && !allFx((c) => !!c.audioFx?.denoise)) {
      out.push({ key: 'denoiseVoice', severity: 'warn', params: { floor: Math.round(floor) }, commands: fxCmds((c) => ({ ...(c.audioFx ?? {}), denoise: true })) });
    }
  }

  // 6) túlvezérelt sáv (a master előtt)
  for (const [type, s] of Object.entries(stats) as [TrackType, TrackStats][]) {
    if (s.peak >= 0.99) {
      const cur = project.trackMix?.[type]?.gain ?? 1;
      const db = -(20 * Math.log10(s.peak) + 1);
      out.push({ key: 'trackClipping', severity: 'error', params: { track: type, db: Math.round(db * 10) / 10 }, commands: [{ type: 'SET_TRACK_GAIN', trackType: type, gain: Math.round(Math.max(0.05, cur * Math.pow(10, db / 20)) * 1000) / 1000 }] });
    }
  }
  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface MasterProposal {
  master: AudioMaster;
  reasons: { key: 'target' | 'dynamicsWide' | 'dynamicsTight' | 'dull' | 'boomy' | 'thin' | 'multiband'; params?: Record<string, string | number> }[];
  /** a master előtti mérés */
  before: { lufs: number; peak: number; lra: number };
}

/** a mastering-javaslat a master nélküli keverés méréséből és a célplatformból */
export function masterProposal(mix: TrackStats, target: AudioMasterTarget, keepDuckTrigger?: TrackType): MasterProposal {
  const base = masterPreset(target);
  const reasons: MasterProposal['reasons'] = [{ key: 'target', params: { target, lufs: base.lufs, tp: base.truePeak } }];
  const lra = loudnessRange(mix.momentary);
  let dynamics = base.dynamics;
  if (lra > 14 && dynamics === 'natural') {
    dynamics = 'balanced';
    reasons.push({ key: 'dynamicsWide', params: { lra: Math.round(lra * 10) / 10 } });
  } else if (lra < 4 && dynamics === 'punchy') {
    dynamics = 'balanced';
    reasons.push({ key: 'dynamicsTight', params: { lra: Math.round(lra * 10) / 10 } });
  }
  const eq = { ...(base.eq ?? { low: 0, mid: 0, high: 0 }) };
  // hangszín: a mély és a magas a középhez képest (dB) — durva billenés-korrekció, legfeljebb ±3 dB
  const hiVsMid = mix.band.high - mix.band.mid;
  const loVsMid = mix.band.low - mix.band.mid;
  if (hiVsMid < -24) {
    eq.high = Math.min(3, eq.high + 2);
    reasons.push({ key: 'dull', params: { db: Math.round(hiVsMid) } });
  }
  if (loVsMid > -3) {
    eq.low = Math.max(-3, eq.low - 2);
    reasons.push({ key: 'boomy', params: { db: Math.round(loVsMid) } });
  } else if (loVsMid < -30) {
    eq.low = Math.min(3, eq.low + 1);
    reasons.push({ key: 'thin', params: { db: Math.round(loVsMid) } });
  }
  const multiband = !!base.multiband || lra > 12;
  if (multiband && !base.multiband) reasons.push({ key: 'multiband', params: { lra: Math.round(lra * 10) / 10 } });
  return {
    master: { ...base, dynamics, eq, ...(multiband ? { multiband: true } : {}), ...(keepDuckTrigger ? { duckTrigger: keepDuckTrigger } : {}) },
    reasons,
    before: { lufs: mix.lufs, peak: mix.peak, lra },
  };
}
