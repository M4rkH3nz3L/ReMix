// 🎧 Audio export-parity SMOKE — per-funkció teszt-projektek (pure, IO-mentes).
//
// Minden fixture egy RÖVID (≤15 mp → a szerver IN-PROCESS rendereli, nem kell
// queue/worker/S3) `kind:'audio'` ReMix-projekt, ami EGY hang-funkciót gyakorol. A
// runner (scripts/audio-smoke.js) ezeket legenerált teszt-hanggal rendereli WAV-ba,
// majd MÉRI (hossz / Integrated LUFS / True-Peak / csatorna-RMS), hogy az EXPORT
// hangzása igazolhatóan a várt legyen („amit hallasz == amit exportálsz"). A
// fixture-ök tiszták → a struktúra unit-tesztelhető.

const MUSIC = 'smoke:music'; // 3 mp szinusz 220 Hz
const VOICE = 'smoke:voice'; // 3 mp szinusz 660 Hz
const SFX = 'smoke:sfx'; // 1 mp szinusz 440 Hz
const DUR = 3;

function clip(uri, over = {}) {
  return {
    id: over.id || 'a1',
    kind: 'audio',
    start: 0,
    duration: DUR,
    uri,
    trimIn: 0,
    sourceDuration: DUR,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...over,
  };
}

const track = (type, clips) => ({ id: `trk-${type}`, type, name: type, clips });

function project(name, tracks, extra = {}) {
  return {
    id: `asmoke-${name}`,
    name: `ASMOKE ${name}`,
    kind: 'audio',
    aspectRatio: '1:1',
    fps: 30,
    tracks,
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...extra,
  };
}

const music = (clips) => track('music', clips);
const voice = (clips) => track('voiceover', clips);
const sfx = (clips) => track('sfx', clips);

/** A fixture-lista: { name, description, project, expect? }. Az `expect` a runner
 * automata ellenőrzéséhez: pl. master-cél LUFS, vagy pan-oldal. */
function buildSmokeProjects() {
  return [
    {
      name: 'baseline',
      description: 'Egy zeneklip, volume=1, nincs fx — REFERENCIA (LUFS/TP/hossz).',
      project: project('baseline', [music([clip(MUSIC)])]),
      expect: { durationSec: DUR, channels: 2 },
    },
    {
      name: 'volume-half',
      description: 'volume=0.5 → mérhetően halkabb a baseline-nál (~ −6 LU).',
      project: project('volume-half', [music([clip(MUSIC, { volume: 0.5 })])]),
      expect: { quieterThan: 'baseline' },
    },
    {
      name: 'fade',
      description: 'fadeIn=1 + fadeOut=1 → a szélek energiája csökken (halkabb integrált LUFS).',
      project: project('fade', [music([clip(MUSIC, { fadeIn: 1, fadeOut: 1 })])]),
      expect: { quieterThan: 'baseline' },
    },
    {
      name: 'pan-left',
      description: 'pan=−1 → a BAL csatorna energiája >> a jobbé.',
      project: project('pan-left', [music([clip(MUSIC, { pan: -1 })])]),
      expect: { panSide: 'left' },
    },
    {
      name: 'pan-right',
      description: 'pan=+1 → a JOBB csatorna energiája >> a balé.',
      project: project('pan-right', [music([clip(MUSIC, { pan: 1 })])]),
      expect: { panSide: 'right' },
    },
    {
      name: 'automation',
      description: 'hangerő-automáció (0→1→0 kulcskockák) — beúszó/kiúszó rámpa.',
      project: project('automation', [
        music([clip(MUSIC, { keyframes: { volume: [
          { time: 0, value: 0 },
          { time: DUR / 2, value: 1 },
          { time: DUR, value: 0 },
        ] } })]),
      ]),
      expect: { quieterThan: 'baseline' },
    },
    {
      name: 'fx-highpass-lowpass',
      description: 'per-klip audioFx: highpass 300 Hz + lowpass 3000 Hz (sáv-korlátozás).',
      project: project('fx-hplp', [music([clip(MUSIC, { audioFx: { highpass: 300, lowpass: 3000 } })])]),
    },
    {
      name: 'fx-eq',
      description: 'per-klip 3-sávos EQ (+6 low / −6 high).',
      project: project('fx-eq', [music([clip(MUSIC, { audioFx: { eq: { low: 6, mid: 0, high: -6 } } })])]),
    },
    {
      name: 'fx-compressor-limiter',
      description: 'per-klip kompresszor + limiter → szűkebb dinamika, lefogott csúcs.',
      project: project('fx-comp', [music([clip(MUSIC, { audioFx: { compressor: true, limiter: true } })])]),
    },
    {
      name: 'fx-reverb-delay',
      description: 'per-klip reverb 0.5 + delay 0.3 (tér/visszhang).',
      project: project('fx-rev', [music([clip(MUSIC, { audioFx: { reverb: 0.5, delay: 0.3 } })])]),
    },
    {
      name: 'fx-denoise-deesser',
      description: 'per-klip denoise + de-esser (zaj/sziszegés).',
      project: project('fx-dn', [voice([clip(VOICE, { audioFx: { denoise: true, deEsser: true } })])]),
    },
    {
      name: 'voice-enhance',
      description: '1-gombos voice-enhance a voiceover-klipen (highpass+denoise+deesser+comp+loudnorm).',
      project: project('venh', [voice([clip(VOICE, { voiceEnhance: true, source: 'voiceover' })])]),
    },
    {
      name: 'de-reverb',
      description: 'de-reverb a voiceover-klipen (visszhang-csökkentés).',
      project: project('derev', [voice([clip(VOICE, { deReverb: true, source: 'voiceover' })])]),
    },
    {
      name: 'autoduck',
      description: 'autoDuck a zenén + voiceover → a zene halkul a beszéd alatt.',
      project: project('duck', [
        music([clip(MUSIC, { autoDuck: true })]),
        voice([clip(VOICE, { id: 'v1', source: 'voiceover' })]),
      ]),
    },
    {
      name: 'master-podcast',
      description: 'Master preset: podcast (−16 LUFS) → a kész mix a célon ±1 LU-n belül.',
      project: project('mpod', [music([clip(MUSIC)])], {
        audioMaster: { target: 'podcast', lufs: -16, truePeak: -1.5, dynamics: 'balanced' },
      }),
      expect: { lufsTarget: -16 },
    },
    {
      name: 'master-music',
      description: 'Master preset: music (−14 LUFS).',
      project: project('mmus', [music([clip(MUSIC)])], {
        audioMaster: { target: 'music', lufs: -14, truePeak: -1, dynamics: 'punchy' },
      }),
      expect: { lufsTarget: -14 },
    },
    {
      name: 'master-multiband',
      description: 'Master (−16) + multiband kompresszor.',
      project: project('mmb', [music([clip(MUSIC)])], {
        audioMaster: { target: 'podcast', lufs: -16, truePeak: -1.5, dynamics: 'balanced', multiband: true, eq: { low: 2, mid: 0, high: 1 } },
      }),
      expect: { lufsTarget: -16 },
    },
    {
      name: 'mix-3track',
      description: 'Három track egyszerre (music+voiceover+sfx) — kompozit mix.',
      project: project('mix3', [
        music([clip(MUSIC, { volume: 0.7 })]),
        voice([clip(VOICE, { id: 'v1', source: 'voiceover' })]),
        sfx([clip(SFX, { id: 'x1', duration: 1, sourceDuration: 1 })]),
      ]),
      expect: { durationSec: DUR },
    },
  ];
}

/** A projektben hivatkozott SZIMBOLIKUS média-uri-k (a runner ezeket generálja). */
function mediaUrisOf(p) {
  const out = new Set();
  for (const trk of p.tracks || []) {
    for (const c of trk.clips || []) {
      if (c.uri) {
        out.add(c.uri);
      }
    }
  }
  return [...out];
}

module.exports = { buildSmokeProjects, mediaUrisOf, SMOKE_AUDIO: { MUSIC, VOICE, SFX }, DUR };
