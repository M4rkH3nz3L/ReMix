import type {
  AspectRatio,
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

export const trackLabels: Record<TrackType, string> = {
  video: 'Videó / kép',
  pip: 'PiP',
  adjust: 'Grade',
  text: 'Szöveg',
  captions: 'Felirat',
  overlay: 'Matrica',
  interactive: 'Interaktív',
  music: 'Zene',
  voiceover: 'Voiceover',
  sfx: 'SFX',
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

export const aspectRatios: { id: AspectRatio; value: number; label: string }[] = [
  { id: '16:9', value: 16 / 9, label: 'Fekvő 16:9' },
  { id: '9:16', value: 9 / 16, label: 'Álló 9:16' },
  { id: '1:1', value: 1, label: 'Négyzet 1:1' },
];

export function aspectValue(id: AspectRatio): number {
  return aspectRatios.find((a) => a.id === id)?.value ?? 16 / 9;
}

/**
 * Szűrő-előnézetek overlay-közelítéssel (a végleges LUT a szerveroldali
 * renderben érvényesül — lásd README).
 */
export const filters: { id: FilterId; label: string; overlay: string | null; opacity: number }[] = [
  { id: 'none', label: 'Nincs', overlay: null, opacity: 0 },
  { id: 'warm', label: 'Meleg', overlay: '#ff9d4d', opacity: 0.18 },
  { id: 'cool', label: 'Hideg', overlay: '#4d9dff', opacity: 0.18 },
  { id: 'mono', label: 'Mono', overlay: '#808080', opacity: 0.45 },
  { id: 'vivid', label: 'Élénk', overlay: '#ff2ea6', opacity: 0.1 },
  { id: 'fade', label: 'Fakó', overlay: '#d8d2c2', opacity: 0.25 },
  { id: 'night', label: 'Éjjel', overlay: '#101040', opacity: 0.35 },
  { id: 'retro', label: 'Retró', overlay: '#c9a24b', opacity: 0.22 },
  { id: 'sunset', label: 'Naplemente', overlay: '#ff6b4a', opacity: 0.2 },
  { id: 'forest', label: 'Erdő', overlay: '#2e8b57', opacity: 0.18 },
];

export const textAnimations: { id: TextAnimation; label: string }[] = [
  { id: 'none', label: 'Nincs' },
  { id: 'fade', label: 'Beúszás' },
  { id: 'slide', label: 'Felcsúszás' },
  { id: 'pulse', label: 'Pulzálás' },
  { id: 'typewriter', label: 'Gépelés' },
  { id: 'pop', label: 'Pop' },
  { id: 'shake', label: 'Rázás' },
  { id: 'karaoke', label: 'Karaoke' },
];

export const textStylePresets: { id: TextStylePreset; label: string }[] = [
  { id: 'plain', label: 'Sima' },
  { id: 'bubble', label: 'Buborék' },
  { id: 'outline', label: 'Kontúr' },
  { id: 'neon', label: 'Neon' },
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
