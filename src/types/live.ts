/**
 * 🎥 Live Studio (OBS-stílusú élő produkció) adatmodell — a `Project`-re lóg
 * (`project.live`), `kind: 'live'` esetén. ADDITÍV/OPCIONÁLIS: a régi projektek
 * `live` nélkül érvényesek (nincs migráció; a `kind` szabad union-bővítés).
 * Terv: devs/tasks/LIVE.md.
 *
 * A vizuális kompozíció a meglévő preview-stacket (PreviewSurface / TextOverlay /
 * ShapeOverlay / PipLayer) használja a nézőnél ÉS az egress-template-ben — EGY
 * jelenet-modell, két renderelő. A szöveg/alakzat overlay-eket a meglévő
 * TextClip / ShapeClip modell hordozza a `LiveSource.ref.clipId`-n át (nem
 * modellezzük újra). A mag (létrehozás/mutáció) tiszta: `src/lib/liveDoc.ts`.
 */

/** Egy élő forrás fajtája (OBS-„source"). */
export type LiveSourceKind =
  | 'camera' // a host kamerája (LiveKit Track.Source.Camera)
  | 'screen' // képernyő-megosztás (LiveKit Track.Source.ScreenShare)
  | 'image' // állókép (asset/uri)
  | 'video' // videó-klip (asset/uri)
  | 'text' // szöveg-overlay (a text-sávon élő TextClip a ref-ben)
  | 'shape' // alakzat-overlay (ShapeClip a ref-ben)
  | 'logo' // logó/vízjel (image, rögzített sarok-pozíció)
  | 'browser'; // böngésző-forrás (url)

/** 0–1 normalizált vászon-elhelyezés (bounding box) + forgatás + z-rend. */
export interface LiveTransform {
  /** bal-felső sarok X, 0–1 (a vászon szélességéhez képest). */
  x: number;
  /** bal-felső sarok Y, 0–1. */
  y: number;
  /** szélesség 0–1. */
  w: number;
  /** magasság 0–1. */
  h: number;
  /** forgatás fokban (hiányzó = 0). */
  rotation?: number;
  /** réteg-sorrend a jeleneten belül (nagyobb = feljebb). */
  z: number;
}

/** Forrás-specifikus hivatkozás (a `kind`-tól függően mely mezők élnek). */
export interface LiveSourceRef {
  /** camera/screen: a bekötött LiveKit track SID-je (élőben töltődik). */
  trackSid?: string;
  /** image/video/logo: média-hivatkozás. */
  assetId?: string;
  uri?: string;
  /** text/shape: a projekt megfelelő sávján élő klip id-je. */
  clipId?: string;
  /** browser: a betöltendő URL. */
  url?: string;
}

/** Egy forrás egy jeleneten belül. */
export interface LiveSource {
  id: string;
  kind: LiveSourceKind;
  /** 0–1 vászon-elhelyezés. */
  transform: LiveTransform;
  /** látható-e a jelenetben (OBS „eye" toggle). */
  visible: boolean;
  /** forrás-specifikus adat. */
  ref?: LiveSourceRef;
  /** megjelenített név a forrás-listában (hiányzó = a `kind`). */
  label?: string;
}

/** Egy jelenet (OBS „scene") — források rendezett halmaza. */
export interface LiveScene {
  id: string;
  name: string;
  sources: LiveSource[];
  /** átmenet hossza a jelenetre váltáskor, ms (hiányzó/0 = azonnali cut). */
  transitionMs?: number;
}

/** Streaming-cél platform. */
export type LivePlatform = 'remix' | 'youtube' | 'tiktok' | 'twitch' | 'facebook' | 'custom';

/** A ReMix-feed az alap-cél; a külső RTMP-célok Pro + szerver-oldali egress. */
export interface LiveDestination {
  id: string;
  platform: LivePlatform;
  label: string;
  enabled: boolean;
  /**
   * custom RTMP ingest-URL (nem-titkos, megjeleníthető). A `stream_key` SOHA nem
   * itt van, hanem a szerver-oldali, titkosított `live_destinations` tárban — a
   * kliens sosem kapja vissza (lásd LIVE.md Fázis E).
   */
  rtmpUrl?: string;
}

// ── 🎚️ Élő audio-mixer (Fázis C) ─────────────────────────────────────────────
// Önálló, egyszerű modell (NEM a nehéz mixer.ts `MixerGraph` — azt a nem-élő
// hang-stúdió használja). A types→lib ciklus elkerülése végett itt él; a tiszta
// műveletek a `src/lib/liveMixer.ts`-ben (ami a mixer.ts dB-utiljait használja).

/** Élő audio-csatorna fajtája. */
export type LiveChannelId = 'mic' | 'music' | 'media' | 'system';

export interface LiveMixerChannel {
  id: LiveChannelId;
  label: string;
  /** erősítés dB-ben (−60..+6; a `mute`/`solo` felülírja az effektív értéket). */
  gainDb: number;
  mute: boolean;
  solo: boolean;
}

export interface LiveMixer {
  channels: LiveMixerChannel[];
  /** master erősítés dB-ben. */
  masterGainDb: number;
  /** auto-duck: a zene halkul, amíg a mikrofon aktív (sidechain). */
  autoDuck: boolean;
}

export type LiveVisibility = 'public' | 'followers' | 'unlisted';

/** A teljes live-produkció dokumentum (a `project.live`-on él). */
export interface LiveDoc {
  /** cím (a feed-kártyán és az élő-szobában). */
  title: string;
  visibility: LiveVisibility;
  scenes: LiveScene[];
  /** az éppen adásban lévő jelenet id-je. */
  activeSceneId: string;
  /** adás-célok (ReMix-feed alapból + külső platformok). */
  destinations: LiveDestination[];
  /** 🎚️ élő audio-mixer (mikrofon/zene/média/rendszer-hang + master + auto-duck). */
  mixer?: LiveMixer;
}
