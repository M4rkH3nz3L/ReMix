// 🎬 Render-parity SMOKE — per-funkció teszt-projektek (pure, IO-mentes).
//
// Minden fixture egy RÖVID (≤15 mp → a szerver IN-PROCESS rendereli, nem kell
// queue/worker/S3) ReMix-projekt, ami EGY render-funkciót gyakorol. A runner
// (scripts/render-smoke.js) ezeket legenerált teszt-médiával rendereli, hogy a
// kész MP4-et VIZUÁLISAN össze lehessen vetni a szerkesztő előnézetével
// (Preview == Export). A fixture-ök tiszták → a struktúra unit-tesztelhető.

const VIDEO = 'smoke:video'; // 3 mp testsrc
const VIDEO2 = 'smoke:video2'; // 3 mp eltérő testsrc (átmenethez)
const AUDIO = 'smoke:audio'; // 3 mp szinusz

const W = 720;
const H = 1280;
const FPS = 30;
const DUR = 3;

function videoClip(over = {}) {
  return {
    id: over.id || 'v1',
    kind: 'video',
    start: 0,
    duration: DUR,
    uri: VIDEO,
    trimIn: 0,
    sourceDuration: DUR,
    speed: 1,
    volume: 1,
    filterId: 'none',
    ...over,
  };
}

function project(name, tracks, extra = {}) {
  return {
    id: `smoke-${name}`,
    name: `SMOKE ${name}`,
    kind: 'video',
    aspectRatio: '9:16',
    fps: FPS,
    tracks,
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...extra,
  };
}

const videoTrack = (clips) => ({ id: 'trk-video', type: 'video', name: 'video', clips });

/** A fixture-lista: { name, description, project }. */
function buildSmokeProjects() {
  return [
    {
      name: 'baseline',
      description: 'Sima videóklip — referencia (nincs effekt).',
      project: project('baseline', [videoTrack([videoClip()])]),
    },
    {
      name: 'keyframe-rotate-opacity',
      description: 'Forgatás 0→45° + áttűnő opacitás kulcskockákkal.',
      project: project('keyframe', [
        videoTrack([
          videoClip({
            keyframes: {
              rotation: [
                { time: 0, value: 0, easing: 'linear' },
                { time: DUR, value: 45, easing: 'linear' },
              ],
              opacity: [
                { time: 0, value: 1, easing: 'linear' },
                { time: DUR, value: 0.3, easing: 'linear' },
              ],
            },
          }),
        ]),
      ]),
    },
    {
      name: 'color-grade',
      description: 'Meleg hőmérséklet + telítettség-csökkentés (adjust).',
      project: project('color', [
        videoTrack([videoClip({ adjust: { temperature: 0.5, saturation: -0.4, contrast: 0.2 } })]),
      ]),
    },
    {
      name: 'effect-chain',
      description: 'Effekt-lánc: blur → vignette (sorrendfüggő).',
      project: project('effect', [
        videoTrack([
          videoClip({
            effects: [
              { id: 'e1', type: 'blur', amount: 0.5 },
              { id: 'e2', type: 'vignette', amount: 0.6 },
            ],
          }),
        ]),
      ]),
    },
    {
      name: 'skew',
      description: 'Dőlés (skew) transzform — a sarok-warp render-parity.',
      project: project('skew', [videoTrack([videoClip({ transform: { skewX: 18, skewY: 0 } })])]),
    },
    {
      name: 'reverse',
      description: 'Visszafelé lejátszott klip (reverse + areverse).',
      project: project('reverse', [videoTrack([videoClip({ reversed: true })])]),
    },
    {
      name: 'speed-2x',
      description: '2× sebesség (a forrás 6 mp-e 3 mp alatt).',
      project: project('speed', [
        videoTrack([videoClip({ speed: 2, duration: DUR, sourceDuration: 2 * DUR })]),
      ]),
    },
    {
      name: 'transition-xfade',
      description: 'Kereszttűnés (xfade) két klip között.',
      project: project('transition', [
        videoTrack([
          videoClip({ id: 'a', start: 0, duration: DUR, transitionOut: { type: 'fade', duration: 1 } }),
          videoClip({ id: 'b', start: DUR - 1, duration: DUR, uri: VIDEO2 }),
        ]),
      ]),
    },
    {
      name: 'text-overlay',
      description: 'Szöveg-réteg (stílus + pozíció) a videó fölött.',
      project: project('text', [
        videoTrack([videoClip()]),
        {
          id: 'trk-text',
          type: 'text',
          name: 'text',
          clips: [
            {
              id: 't1',
              kind: 'text',
              start: 0,
              duration: DUR,
              text: 'PARITY ✓',
              color: '#ffffff',
              backgroundColor: null,
              fontSize: 9,
              fontWeight: 'bold',
              position: { x: 0.5, y: 0.5 },
              animation: 'pop',
            },
          ],
        },
      ]),
    },
    {
      name: 'audio-fx',
      description: 'Hang-FX: 3-sávos EQ + kompresszor (hallható a kimenetben).',
      project: project('audiofx', [
        videoTrack([videoClip({ volume: 0 })]),
        {
          id: 'trk-music',
          type: 'music',
          name: 'music',
          clips: [
            {
              id: 'm1',
              kind: 'audio',
              start: 0,
              duration: DUR,
              uri: AUDIO,
              label: 'sine',
              volume: 1,
              fadeIn: 0,
              fadeOut: 0,
              source: 'imported',
              audioFx: { eq: { low: 6, mid: 0, high: -4 }, compressor: true },
            },
          ],
        },
      ]),
    },
  ];
}

/** A projektben hivatkozott SZIMBOLIKUS média-uri-k (a runner ezeket generálja). */
function mediaUrisOf(proj) {
  const out = new Set();
  for (const track of proj.tracks || []) {
    for (const clip of track.clips || []) {
      if ((clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') && clip.uri) {
        out.add(clip.uri);
      }
      if (clip.kind === 'shape' && clip.imageUri) {
        out.add(clip.imageUri);
      }
    }
  }
  return [...out];
}

/** A projekt leghosszabb sáv-vége (mp) — a ≤15 mp in-process garanciához. */
function projectDurationOf(proj) {
  let max = 0;
  for (const track of proj.tracks || []) {
    for (const clip of track.clips || []) {
      max = Math.max(max, (clip.start || 0) + (clip.duration || 0));
    }
  }
  return max;
}

module.exports = { buildSmokeProjects, mediaUrisOf, projectDurationOf, SMOKE_MEDIA: { VIDEO, VIDEO2, AUDIO }, W, H, FPS, DUR };
