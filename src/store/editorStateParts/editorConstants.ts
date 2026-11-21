import type { VideoPanelId } from '@/lib/panelSpecs';

// REFACTOR: az editorState.ts-ből — a store-szintű érték-típusok és konstansok (változatlanul)

/** 🎯 proxy minőség-tier → a proxy leghosszabb oldala (px) */
export type ProxyQuality = 'low' | 'medium' | 'high';
export const PROXY_MAX_SIDE: Record<ProxyQuality, number> = { low: 640, medium: 960, high: 1280 };

/** 🔎 melyik „insight" sáv látszik az idővonal fölött (egyszerre egy — kevesebb chrome) */
export type InsightLane = 'story' | 'map' | 'pacing';

/** 🧲 idővonal-illesztés erőssége: ki / normál / erős (a küszöböt skálázza) */
export type SnapStrength = 'off' | 'normal' | 'strong';
/** erősség → SNAP_PX szorzó (0 = nincs illesztés) */
export const SNAP_FACTOR: Record<SnapStrength, number> = { off: 0, normal: 1, strong: 2 };

/**
 * ✂️ Trim-mód (profi vágó-viselkedés). A `normal` a hagyományos trim/mozgatás;
 * a `ripple` a mögötte lévőket tolja; a `roll`, `slip`, `slide` a szomszédos
 * klipekkel dolgozik (lásd `rollEdit`/`slipEdit`/`slideEdit`). A trim-fogantyú
 * a roll/ripple/normal szerint viselkedik, a klip-test húzása a slip/slide/normal
 * szerint — így egy módválasztóval az összes profi vágás elérhető.
 */
export type TrimMode = 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';
export const TRIM_MODES: TrimMode[] = ['normal', 'ripple', 'roll', 'slip', 'slide'];

/**
 * 🧲 Illesztési CÉLPONTOK: melyik fajtára kapjon a klip-él/lejátszófej. A magnet
 * gomb hosszú nyomása kapcsolja őket; a `snapStrength: 'off'` mindent kikapcsol.
 */
export interface SnapTargets {
  playhead: boolean;
  clips: boolean;
  markers: boolean;
  beats: boolean;
  regions: boolean;
}
export const DEFAULT_SNAP_TARGETS: SnapTargets = {
  playhead: true,
  clips: true,
  markers: true,
  beats: true,
  regions: true,
};

/** 🏷️ timeline-régió színek — új régió ciklikusan kap, az átszínezés ezen lépked */
export const REGION_COLORS = ['#7c5cff', '#4a9eff', '#2ecc8f', '#ffb454', '#ff5ca8', '#ff6b6b'];

/** a panel-azonosítók egyetlen forrása a panel-regiszter (`@/lib/panelSpecs`) */
export type PanelId = VideoPanelId | null;

/** Kijelöléshez nem kötött panelek — nyitva maradnak kijelölés nélkül is. */
export const STANDALONE_PANELS: PanelId[] = [
  'audio',
  'export',
  'imagedoc',
  'captions',
  'sticker',
  'assistant',
  'library',
  'transcript',
  'multicam',
  'creatorPreset',
  'workflow',
];

export const HISTORY_LIMIT = 50;
/** ennyi eseményt őrzünk meg projektenként (AI-memória nyersanyag) */
export const EVENT_LIMIT = 300;

/** a sáv-kapcsolók state-kulcsai — mind `TrackType[]`-et tárol */
export type TrackFlagKey =
  | 'mutedTracks'
  | 'soloTracks'
  | 'collapsedTracks'
  | 'hiddenTracks'
  | 'lockedTracks';
