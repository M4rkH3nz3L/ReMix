import { NORMALIZE_LUFS, type Biquad } from '@/lib/audioDsp';
import { kWeighting } from '@/lib/loudness';
import type { Project, TrackType } from '@/types/project';

/**
 * 🩺 Projektszintű hangellenőrzés — tiszta mag, a telefonon (offline). A kész keverést darabonként
 * kapja (`MixAnalyzer.push`), és méri: a csúcsot (túlvezérlés), az integrált hangosságot (BS.1770 —
 * blokkra pontosan az `integratedLoudness`), a hosszú csendet és a fázis-kioltást (a bal és a
 * jobb csatorna ellentétes). Mellé a szerkezeti hibák (hiányzó fájl, némított/szóló sáv, néma
 * vagy elvágott maradék klip). Az eredmény időpontos hibalista — koppintásra oda ugrik.
 */

export type CheckKind = 'clipping' | 'loudness' | 'silence' | 'phase' | 'missing' | 'muted' | 'solo' | 'zeroVolume' | 'sliver' | 'empty';
export type CheckSeverity = 'error' | 'warn';

export interface CheckIssue {
  kind: CheckKind;
  severity: CheckSeverity;
  /** idővonal-mp (ha helyhez kötött) */
  start?: number;
  end?: number;
  /** a szöveg paraméterei (i18n) */
  params?: Record<string, string | number>;
}

export interface MixStats {
  duration: number;
  peak: number;
  lufs: number;
  clipping: { start: number; end: number }[];
  silence: { start: number; end: number }[];
  phase: { start: number; end: number }[];
}

/** ennél a csúcsnál a jel a plafonon van (−0,1 dBFS) */
export const CLIP_LEVEL = Math.pow(10, -0.1 / 20);
/** csend: −60 dBFS alatti 100 ms-os ablakok, legalább ennyi mp-ig */
export const SILENCE_MIN_SEC = 2;
/** fázis-kioltás: a 1 s-os ablak korrelációja ez alatt (hangos részen) */
export const PHASE_LIMIT = -0.5;
/** a hangosság ennyi LU-val térhet el a céltól */
export const LOUDNESS_TOLERANCE = 2;
/** ennél rövidebb klip valószínűleg vágási maradék (mp) */
export const SLIVER_SEC = 0.1;

/** a szomszédos/átfedő tartományok összevonása (`gap` mp-en belül) */
function mergeRanges(r: { start: number; end: number }[], gap: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const x of r) {
    const last = out[out.length - 1];
    if (last && x.start - last.end <= gap) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

export class MixAnalyzer {
  private readonly sub: number;
  private readonly corrWin: number;
  private readonly k: Biquad[];
  private pos = 0;
  private peak = 0;
  // 100 ms-os ablak (csúcs, csend, K-súlyozott energia)
  private wPeak = 0;
  private wSq = 0;
  private wK = 0;
  private wN = 0;
  private readonly kEnergy: number[] = [];
  private readonly clips: { start: number; end: number }[] = [];
  private silentFrom = -1;
  private readonly silence: { start: number; end: number }[] = [];
  // 1 s-os korreláció
  private cLR = 0;
  private cLL = 0;
  private cRR = 0;
  private cN = 0;
  private readonly phase: { start: number; end: number }[] = [];

  constructor(private readonly sr: number) {
    this.sub = Math.round(0.1 * sr);
    this.corrWin = sr;
    this.k = kWeighting(sr);
  }

  push(l: Float32Array, r: Float32Array): void {
    const kl = Float32Array.from(l);
    const kr = Float32Array.from(r);
    for (const f of this.k) f.processStereo(kl, kr);
    for (let i = 0; i < l.length; i++) {
      const a = Math.abs(l[i]) > Math.abs(r[i]) ? Math.abs(l[i]) : Math.abs(r[i]);
      if (a > this.wPeak) this.wPeak = a;
      this.wSq += (l[i] * l[i] + r[i] * r[i]) / 2;
      this.wK += kl[i] * kl[i] + kr[i] * kr[i];
      this.wN++;
      this.cLR += l[i] * r[i];
      this.cLL += l[i] * l[i];
      this.cRR += r[i] * r[i];
      this.cN++;
      this.pos++;
      if (this.wN === this.sub) this.closeWindow();
      if (this.cN === this.corrWin) this.closeCorr();
    }
  }

  private closeWindow(): void {
    // ms-ra kerekítve (a 4,0 s ne 3,99999 legyen)
    const t1 = Math.round((this.pos / this.sr) * 1000) / 1000;
    const t0 = Math.round(((this.pos - this.wN) / this.sr) * 1000) / 1000;
    if (this.wPeak > this.peak) this.peak = this.wPeak;
    if (this.wPeak >= CLIP_LEVEL) this.clips.push({ start: t0, end: t1 });
    const quiet = this.wSq / this.wN < 1e-6; // −60 dBFS
    if (quiet && this.silentFrom < 0) this.silentFrom = t0;
    if (!quiet && this.silentFrom >= 0) {
      if (t0 - this.silentFrom >= SILENCE_MIN_SEC - 1e-9) this.silence.push({ start: this.silentFrom, end: t0 });
      this.silentFrom = -1;
    }
    if (this.wN === this.sub) this.kEnergy.push(this.wK);
    this.wPeak = 0;
    this.wSq = 0;
    this.wK = 0;
    this.wN = 0;
  }

  private closeCorr(): void {
    const t1 = Math.round((this.pos / this.sr) * 1000) / 1000;
    const loud = (this.cLL + this.cRR) / (2 * this.cN) > 1e-5; // −50 dBFS
    const corr = this.cLL > 0 && this.cRR > 0 ? this.cLR / Math.sqrt(this.cLL * this.cRR) : 1;
    if (loud && corr < PHASE_LIMIT) this.phase.push({ start: Math.round(((this.pos - this.cN) / this.sr) * 1000) / 1000, end: t1 });
    this.cLR = 0;
    this.cLL = 0;
    this.cRR = 0;
    this.cN = 0;
  }

  /** a mérés lezárása; a hangosság a BS.1770 kapuzással (400 ms-os blokk, 100 ms-os lépés) */
  finish(): MixStats {
    if (this.wN > 0) this.closeWindow();
    const duration = this.pos / this.sr;
    if (this.silentFrom >= 0 && duration - this.silentFrom >= SILENCE_MIN_SEC - 1e-9) this.silence.push({ start: this.silentFrom, end: duration });
    this.silentFrom = -1;
    const block = 4 * this.sub;
    const powers: number[] = [];
    for (let b = 0; b + 4 <= this.kEnergy.length; b++) {
      powers.push((this.kEnergy[b] + this.kEnergy[b + 1] + this.kEnergy[b + 2] + this.kEnergy[b + 3]) / block);
    }
    const lufsOf = (p: number) => -0.691 + 10 * Math.log10(p);
    const abs = powers.filter((p) => lufsOf(p) > -70);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    let lufs = -Infinity;
    if (abs.length > 0) {
      const rel = abs.filter((p) => lufsOf(p) > lufsOf(mean(abs)) - 10);
      lufs = rel.length > 0 ? lufsOf(mean(rel)) : -Infinity;
    }
    return {
      duration,
      peak: this.peak,
      lufs,
      clipping: mergeRanges(this.clips, 0.3),
      silence: this.silence,
      phase: mergeRanges(this.phase, 0),
    };
  }
}

/** a jel-mérésből hibák; a hangosság célja a master célja, ennek hiányában −16 LUFS */
export function signalIssues(stats: MixStats, targetLufs: number = NORMALIZE_LUFS): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const c of stats.clipping) out.push({ kind: 'clipping', severity: 'error', start: c.start, end: c.end });
  if (Number.isFinite(stats.lufs) && Math.abs(stats.lufs - targetLufs) > LOUDNESS_TOLERANCE) {
    out.push({ kind: 'loudness', severity: 'warn', params: { lufs: Math.round(stats.lufs * 10) / 10, target: targetLufs, dir: stats.lufs < targetLufs ? 'quiet' : 'loud' } });
  }
  for (const s of stats.silence) out.push({ kind: 'silence', severity: 'warn', start: s.start, end: s.end, params: { sec: Math.round((s.end - s.start) * 10) / 10 } });
  for (const p of stats.phase) out.push({ kind: 'phase', severity: 'error', start: p.start, end: p.end });
  return out;
}

/** szerkezeti hibák: hiányzó fájl, némított/szóló sáv, néma klip, vágási maradék */
export function structuralIssues(
  project: Pick<Project, 'tracks'>,
  opts: { missing: Set<string>; muted: TrackType[]; solo: TrackType[]; audio: (t: TrackType) => boolean }
): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const t of project.tracks) {
    if (!opts.audio(t.type)) continue;
    const clips = t.clips.filter((c) => c.kind === 'audio');
    if (clips.length === 0) continue;
    if (opts.solo.length > 0 && !opts.solo.includes(t.type)) out.push({ kind: 'solo', severity: 'warn', params: { track: t.type } });
    else if (opts.muted.includes(t.type)) out.push({ kind: 'muted', severity: 'warn', params: { track: t.type } });
    for (const c of clips) {
      const end = c.start + c.duration;
      if ('uri' in c && opts.missing.has(c.uri)) out.push({ kind: 'missing', severity: 'error', start: c.start, end, params: { track: t.type } });
      if ('volume' in c && c.volume === 0 && !(c.keyframes?.volume ?? []).some((k) => k.value > 0)) out.push({ kind: 'zeroVolume', severity: 'warn', start: c.start, end, params: { track: t.type } });
      if (c.duration < SLIVER_SEC) out.push({ kind: 'sliver', severity: 'warn', start: c.start, end, params: { track: t.type, ms: Math.round(c.duration * 1000) } });
    }
  }
  return out;
}

/** a teljes lista: hibák előre, időrendben */
export function sortIssues(issues: CheckIssue[]): CheckIssue[] {
  const rank = (i: CheckIssue) => (i.severity === 'error' ? 0 : 1);
  return [...issues].sort((a, b) => rank(a) - rank(b) || (a.start ?? -1) - (b.start ?? -1));
}
