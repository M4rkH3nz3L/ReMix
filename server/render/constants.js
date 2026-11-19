// 🎬 A render közös konstansai (képarány-vásznak, hossz-plafonok, blend- és átmenet-térképek).
// (A server/render.js-ből kiemelve, változatlan tartalommal.)

const FPS = 30;

// 🎬 A videó MAX hossza — 10 perc (short-video scope, devs/tasks/SCOPES.md). A /render
// HARD-ENFORCE-olja; a kliens tükre: src/lib/projectUtils.ts MAX_PROJECT_DURATION_SEC
// (contract-teszt zárolja az egyezést). Tier-szinten szigoríthatóbb, feljebb nem.
const MAX_RENDER_DURATION_SEC = 600;
/**
 * 🎧 AUDIO-PROD S18: a CSAK HANG export (podcast, album) nem rövid videó — a 10 perces videó-plafon
 * alól kivéve, a telefonos export 3 órás határával egyezően (env: MAX_AUDIO_RENDER_SEC).
 */
const MAX_AUDIO_RENDER_DURATION_SEC = Math.max(MAX_RENDER_DURATION_SEC, parseInt(process.env.MAX_AUDIO_RENDER_SEC || '10800', 10) || 10800);

/** a render hossz-plafonja a kért beállítás szerint: csak-hang (audioFormat) → a hang plafonja, különben a videóé */
function maxRenderSecFor(settings) {
  return settings && settings.audioFormat ? MAX_AUDIO_RENDER_DURATION_SEC : MAX_RENDER_DURATION_SEC;
}

const CANVAS = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
  // 📸 Instagram-feed (batch-export preset) — eddig csendben 9:16 lett (B14)
  '4:5': { w: 1080, h: 1350 },
};

// 🎨 blend-mód → ffmpeg `blend=all_mode` név (a többi 1:1; a preview CSS-neve külön)
const FFMPEG_BLEND = { colordodge: 'dodge', colorburn: 'burn' };
const blendName = (m) => FFMPEG_BLEND[m] || m;

// 🧊 3D/dinamikus átmenet (klip transitionOut) → ffmpeg xfade-alapmód. EGYETLEN
// forrás: a kliens-tükre src/lib/transitions.ts TRANSITION_XFADE, amit a
// contract-teszt `toEqual`-lal zárol (preview == export). NE változtasd a
// render-viselkedést — csak a map él modul-szinten, hogy exportálható legyen.
const XFADE_MODES = {
  zoom: 'zoomin',
  spin: 'squeezeh',
  flip: 'squeezev',
  cube: 'smoothleft',
  circle: 'circleopen',
  dissolve: 'dissolve',
  // 2D átmenetek — közvetlen ffmpeg xfade-nevek
  wipeLeft: 'wipeleft',
  wipeRight: 'wiperight',
  wipeUp: 'wipeup',
  wipeDown: 'wipedown',
  slideLeft: 'slideleft',
  slideRight: 'slideright',
  pixelize: 'pixelize',
  blur: 'hblur',
  fadeBlack: 'fadeblack',
  fadeWhite: 'fadewhite',
  radial: 'radial',
};

// 🧭 irány: az irányos családoknál (wipe/slide/cube) az xfade-variánst váltja,
// különben az alapmód. UGYANAZ a logika, mint a kliensen (transitions.ts xfadeMode).
function xfadeMode(type, direction) {
  const base = XFADE_MODES[type];
  if (direction) {
    if (type.startsWith('wipe')) return `wipe${direction}`;
    if (type.startsWith('slide')) return `slide${direction}`;
    if (type === 'cube') return `smooth${direction}`;
  }
  return base;
}

module.exports = {
  FPS,
  MAX_RENDER_DURATION_SEC,
  MAX_AUDIO_RENDER_DURATION_SEC,
  maxRenderSecFor,
  CANVAS,
  FFMPEG_BLEND,
  blendName,
  XFADE_MODES,
  xfadeMode,
};
