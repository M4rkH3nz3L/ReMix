import type {
  AspectRatio,
  BlendMode,
  FilterId,
  TextAnimation,
  TextStylePreset,
  TrackType,
} from '@/types/project';

export const palette = {
  bg: '#07080d',
  surface: '#111420',
  surfaceHigh: '#1a1e2e',
  border: '#252a3d',
  text: '#f4f5fa',
  textDim: '#8d93a8',
  accent: '#7c5cff',
  accent2: '#ff5ca8',
  accentSoft: '#7c5cff2e',
  danger: '#ff5c72',
  ok: '#2ecc8f',
} as const;

/** a márka-gradiens (gombok, aktív állapotok, play) */
export const accentGradient = ['#7c5cff', '#b95ce0', '#ff5ca8'] as const;

/** sáv-színek az idővonalon */
export const trackColors: Record<TrackType, string> = {
  video: '#3d6bff',
  pip: '#5ac8ff',
  adjust: '#f5a623',
  text: '#c447d6',
  captions: '#ff5ca8',
  overlay: '#00cec9',
  interactive: '#f5a623',
  music: '#2ecc8f',
  voiceover: '#48dbfb',
  sfx: '#ff8c5a',
};

/** 🌍 A `label` értékek i18n-kulcsok — a fogyasztó `t(trackLabels[type])`-ként fordítja. */
export const trackLabels: Record<TrackType, string> = {
  video: 'editor.track.video',
  pip: 'editor.track.pip',
  adjust: 'editor.track.adjust',
  text: 'editor.track.text',
  captions: 'editor.track.captions',
  overlay: 'editor.track.overlay',
  interactive: 'editor.track.interactive',
  music: 'editor.track.music',
  voiceover: 'editor.track.voiceover',
  sfx: 'editor.track.sfx',
};

export const trackOrder: TrackType[] = [
  'video',
  'pip',
  'adjust',
  'text',
  'captions',
  'overlay',
  'interactive',
  'music',
  'voiceover',
  'sfx',
];

export const trackHeights: Record<TrackType, number> = {
  video: 52,
  pip: 44,
  adjust: 30,
  text: 30,
  captions: 30,
  overlay: 30,
  interactive: 30,
  // a hangsávok magasabbak — a hullámformának hely kell (látványterv)
  music: 42,
  voiceover: 40,
  sfx: 30,
};

// 🌍 A `label` i18n-kulcs — a fogyasztó `t(option.label)`-ként fordítja.
export const aspectRatios: { id: AspectRatio; value: number; label: string }[] = [
  { id: '16:9', value: 16 / 9, label: 'editor.aspect.landscape' },
  { id: '9:16', value: 9 / 16, label: 'editor.aspect.portrait' },
  { id: '1:1', value: 1, label: 'editor.aspect.square' },
];

export function aspectValue(id: AspectRatio): number {
  return aspectRatios.find((a) => a.id === id)?.value ?? 16 / 9;
}

/**
 * Szűrő-előnézetek overlay-közelítéssel (a végleges LUT a szerveroldali
 * renderben érvényesül — lásd README).
 */
// 🌍 A `label` i18n-kulcs — a fogyasztó `t(filter.label)`-ként fordítja.
export const filters: { id: FilterId; label: string; overlay: string | null; opacity: number }[] = [
  { id: 'none', label: 'editor.filter.none', overlay: null, opacity: 0 },
  { id: 'warm', label: 'editor.filter.warm', overlay: '#ff9d4d', opacity: 0.18 },
  { id: 'cool', label: 'editor.filter.cool', overlay: '#4d9dff', opacity: 0.18 },
  { id: 'mono', label: 'editor.filter.mono', overlay: '#808080', opacity: 0.45 },
  { id: 'vivid', label: 'editor.filter.vivid', overlay: '#ff2ea6', opacity: 0.1 },
  { id: 'fade', label: 'editor.filter.fade', overlay: '#d8d2c2', opacity: 0.25 },
  { id: 'night', label: 'editor.filter.night', overlay: '#101040', opacity: 0.35 },
  { id: 'retro', label: 'editor.filter.retro', overlay: '#c9a24b', opacity: 0.22 },
  { id: 'sunset', label: 'editor.filter.sunset', overlay: '#ff6b4a', opacity: 0.2 },
  { id: 'forest', label: 'editor.filter.forest', overlay: '#2e8b57', opacity: 0.18 },
];

// 🌍 A `label` i18n-kulcs — a fogyasztó `t(anim.label)`-ként fordítja.
export const textAnimations: { id: TextAnimation; label: string }[] = [
  { id: 'none', label: 'editor.textAnim.none' },
  { id: 'fade', label: 'editor.textAnim.fade' },
  { id: 'slide', label: 'editor.textAnim.slide' },
  { id: 'pulse', label: 'editor.textAnim.pulse' },
  { id: 'typewriter', label: 'editor.textAnim.typewriter' },
  { id: 'pop', label: 'editor.textAnim.pop' },
  { id: 'shake', label: 'editor.textAnim.shake' },
  { id: 'karaoke', label: 'editor.textAnim.karaoke' },
];

// 🌍 A `label` i18n-kulcs — a fogyasztó `t(preset.label)`-ként fordítja.
export const textStylePresets: { id: TextStylePreset; label: string }[] = [
  { id: 'plain', label: 'editor.textStyle.plain' },
  { id: 'bubble', label: 'editor.textStyle.bubble' },
  { id: 'outline', label: 'editor.textStyle.outline' },
  { id: 'neon', label: 'editor.textStyle.neon' },
];

export const textColors = [
  '#ffffff',
  '#0c0d12',
  '#ffd166',
  '#ff5c72',
  '#2ecc8f',
  '#4d9dff',
  '#c447d6',
  '#f5a623',
];

/**
 * 🎨 Keverési módok — közös lista a PiP/Forma panelekhez. A `label` i18n-kulcs.
 * A preview a `cssBlendMode`-dal fordítja RN `mixBlendMode`-ra, a render az
 * ffmpeg `blend=all_mode`-ra (a colordodge/colorburn ott `dodge`/`burn`).
 */
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'multiply', label: 'editor.blend.multiply' },
  { value: 'screen', label: 'editor.blend.screen' },
  { value: 'overlay', label: 'editor.blend.overlay' },
  { value: 'darken', label: 'editor.blend.darken' },
  { value: 'lighten', label: 'editor.blend.lighten' },
  { value: 'difference', label: 'editor.blend.difference' },
  { value: 'exclusion', label: 'editor.blend.exclusion' },
  { value: 'hardlight', label: 'editor.blend.hardlight' },
  { value: 'softlight', label: 'editor.blend.softlight' },
  { value: 'colordodge', label: 'editor.blend.colordodge' },
  { value: 'colorburn', label: 'editor.blend.colorburn' },
];

/** RN `mixBlendMode` (CSS) blend-nevek — a `cssBlendMode` ezek egyikét adja */
export type CssBlendMode =
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'hard-light'
  | 'soft-light'
  | 'color-dodge'
  | 'color-burn';

/** blend-mód → RN `mixBlendMode` (CSS) érték */
export function cssBlendMode(m: BlendMode): CssBlendMode {
  switch (m) {
    case 'hardlight':
      return 'hard-light';
    case 'softlight':
      return 'soft-light';
    case 'colordodge':
      return 'color-dodge';
    case 'colorburn':
      return 'color-burn';
    default:
      // a maradék (multiply/screen/overlay/darken/lighten/difference/exclusion) = érvényes CSS-név
      return m as CssBlendMode;
  }
}

export const speedPresets = [0.25, 0.5, 1, 1.5, 2, 4];

/** idővonal-lépték: pixel/másodperc = BASE * zoom */
export const BASE_PX_PER_SEC = 60;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

/** ennél rövidebbre nem vágható klip (mp) */
/**
 * A szerkesztés képkocka-rácsa. A worker alapértelmezett render-FPS-e is 30
 * (server/render.js) — a képkocka-pontos léptetés erre igazít, hogy amit a
 * panelen beállítasz, az a renderben is kockára essen.
 */
export const EDIT_FPS = 30;
export const FRAME = 1 / EDIT_FPS;

export const MIN_CLIP_DURATION = 0.2;

/** mágneses illesztés küszöbe pixelben */
export const SNAP_PX = 8;
