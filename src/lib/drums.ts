/**
 * 🥁 Dob-gép / step-sequencer mag (AUDIOT §5) — pure + tesztelt.
 *
 * A dob-minta egy RÁCS: hangonként (kick/snare/hihat/clap) 16 lépés/ütem. A hangokat a worker
 * (`server/drums.js`) SZINTETIZÁLJA (nincs minta-fájl-függés), a lépés-időzítés itt él (BPM →
 * lépés-mp), hogy önmagában tesztelhető legyen. Expo-mentes.
 */

/** 🥁 S12 (MU3): 8 hang — a régi 4 + tom, rim, crash, perc; a régi minták (4 sor) változatlanul érvényesek */
export type DrumVoice = 'kick' | 'snare' | 'hihat' | 'clap' | 'tom' | 'rim' | 'crash' | 'perc';

export const DRUM_VOICES: DrumVoice[] = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'crash', 'perc'];
export const STEPS_PER_BAR = 16; // 16-od felbontás

export type DrumPattern = Record<DrumVoice, boolean[]>;
export interface DrumHit {
  voice: DrumVoice;
  /** lépés (16-od); swinggel tört is lehet */
  step: number;
  /** 1–127 (hiányzó = a normál ütés, 0,9-es szint — a worker és a telefon is) */
  velocity?: number;
}

/** ütésenkénti velocity a rács mellett (hiányzó cella = normál ütés) */
export type DrumVelocity = Partial<Record<DrumVoice, (number | undefined)[]>>;

/** a három szint: normál (alap) → hangsúlyos → halk → normál */
export const DRUM_ACCENT = 127;
export const DRUM_SOFT = 64;
/** a swing felső határa (a lépés 60 %-a) */
export const SWING_MAX = 0.6;

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Egy lépés hossza mp-ben: 1 ütem = 4 beat = 16 lépés → lépés = (60/bpm)/4. */
export function stepSec(bpm: number): number {
  return round(60 / (bpm > 0 ? bpm : 120) / 4);
}

/** Lépés-szám `bars` ütemre. */
export function stepCount(bars: number): number {
  return Math.max(1, Math.floor(bars)) * STEPS_PER_BAR;
}

/** Üres minta (minden hang × minden lépés = false). */
export function emptyPattern(bars: number): DrumPattern {
  const n = stepCount(bars);
  const p = {} as DrumPattern;
  for (const v of DRUM_VOICES) {
    p[v] = new Array(n).fill(false);
  }
  return p;
}

/** Egy cella be/ki (immutábilis). */
export function toggleStep(pattern: DrumPattern, voice: DrumVoice, step: number): DrumPattern {
  const row = pattern[voice] ?? [];
  if (step < 0 || step >= row.length) {
    return pattern;
  }
  const next = row.slice();
  next[step] = !next[step];
  return { ...pattern, [voice]: next };
}

/**
 * A minta aktív ütései (voice + step [+ velocity]) — a worker és a telefonos render bemenete.
 * `swing` (0–0,6): a páros 16-odok (a 2., 4., … lépés, 0-alapon a páratlan indexek) késése a
 * lépés-hossz arányában — a tört lépést a telefon mintára, a worker ms-ra pontosan helyezi.
 */
export function patternHits(pattern: DrumPattern, velocity: DrumVelocity = {}, swing = 0): DrumHit[] {
  const sw = Math.max(0, Math.min(SWING_MAX, Number.isFinite(swing) ? swing : 0));
  const hits: DrumHit[] = [];
  for (const v of DRUM_VOICES) {
    (pattern[v] ?? []).forEach((on, step) => {
      if (on) {
        const vel = velocity[v]?.[step];
        const at = step % 2 === 1 && sw > 0 ? step + sw : step;
        hits.push(vel ? { voice: v, step: at, velocity: vel } : { voice: v, step: at });
      }
    });
  }
  return hits;
}

/** egy ütés velocity-jének léptetése: normál → hangsúlyos → halk → normál (immutábilis) */
export function cycleVelocity(velocity: DrumVelocity, voice: DrumVoice, step: number): DrumVelocity {
  const row = (velocity[voice] ?? []).slice();
  const cur = row[step];
  row[step] = cur === undefined ? DRUM_ACCENT : cur === DRUM_ACCENT ? DRUM_SOFT : undefined;
  return { ...velocity, [voice]: row };
}

/** a rács-hossz változásakor a velocity-sorok vágása */
export function resizeVelocity(velocity: DrumVelocity, bars: number): DrumVelocity {
  const n = stepCount(bars);
  const out: DrumVelocity = {};
  for (const v of DRUM_VOICES) {
    if (velocity[v]) out[v] = velocity[v]!.slice(0, n);
  }
  return out;
}

/** Egy ütés időpontja mp-ben. */
export function hitTimeSec(step: number, bpm: number): number {
  return round(Math.max(0, step) * stepSec(bpm));
}

/** A minta teljes hossza mp-ben (a teljes rács, nem csak az utolsó ütés). */
export function patternDurationSec(bars: number, bpm: number): number {
  return round(stepCount(bars) * stepSec(bpm));
}

/** Van-e bármi aktív ütés. */
export function hasHits(pattern: DrumPattern): boolean {
  return DRUM_VOICES.some((v) => (pattern[v] ?? []).some(Boolean));
}

/** Rövid címke a hang-sorokhoz. */
export const DRUM_LABEL: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hihat: 'Hihat',
  clap: 'Clap',
  tom: 'Tom',
  rim: 'Rim',
  crash: 'Crash',
  perc: 'Perc',
};

/** a régi (4 soros) vagy hiányos minta kiegészítése minden hangra, a rács hosszára (immutábilis) */
export function normalizePattern(pattern: Partial<DrumPattern> | null | undefined, bars: number): DrumPattern {
  const n = stepCount(bars);
  const out = {} as DrumPattern;
  for (const v of DRUM_VOICES) {
    const row = pattern?.[v] ?? [];
    out[v] = Array.from({ length: n }, (_, i) => row[i] === true);
  }
  return out;
}

// ── 🥁 beépített minta-készletek (S12): gyors kezdés — a rács felülíródik ──────────────────────

export type DrumKitId = 'basic' | 'house' | 'hiphop';
export const DRUM_KITS: readonly DrumKitId[] = ['basic', 'house', 'hiphop'];

/** egy 1 ütemes (16 lépéses) készlet: hangonként a lépések, ahol üt; `accent` = hangsúlyos lépések */
const KIT_STEPS: Record<DrumKitId, Partial<Record<DrumVoice, number[]>> & { accent?: Partial<Record<DrumVoice, number[]>>; swing?: number }> = {
  basic: { kick: [0, 8], snare: [4, 12], hihat: [0, 2, 4, 6, 8, 10, 12, 14] },
  house: { kick: [0, 4, 8, 12], clap: [4, 12], hihat: [2, 6, 10, 14], perc: [3, 11], accent: { kick: [0] } },
  hiphop: { kick: [0, 3, 8, 10], snare: [4, 12], hihat: [0, 2, 4, 6, 8, 10, 12, 14], rim: [7, 15], tom: [14], accent: { snare: [4, 12] }, swing: 0.2 },
};

/** a készlet mintája `bars` ütemre ismételve (+ hangsúlyok, swing) */
export function drumKit(kit: DrumKitId, bars: number): { pattern: DrumPattern; velocity: DrumVelocity; swing: number } {
  const def = KIT_STEPS[kit];
  const b = Math.max(1, Math.min(4, Math.floor(bars) || 1));
  const pattern = emptyPattern(b);
  const velocity: DrumVelocity = {};
  for (const v of DRUM_VOICES) {
    const steps = def[v] ?? [];
    const acc = def.accent?.[v] ?? [];
    for (let bar = 0; bar < b; bar++) {
      for (const s of steps) pattern[v][bar * STEPS_PER_BAR + s] = true;
      for (const s of acc) {
        velocity[v] = velocity[v] ?? [];
        velocity[v]![bar * STEPS_PER_BAR + s] = DRUM_ACCENT;
      }
    }
  }
  return { pattern, velocity, swing: def.swing ?? 0 };
}
