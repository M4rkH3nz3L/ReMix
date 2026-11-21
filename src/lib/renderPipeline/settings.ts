// 🎛️ Export-beállítások (típusok, platform-presetek, felhő-igény) — expo-mentes mag.

/** Export-beállítások (látványterv szerint) — a worker rendere olvassa. */
/** videó-kodek: h264 = univerzális; hevc = modern eszköz+felhő; av1/prores = felhő */
export type RenderCodec = 'h264' | 'hevc' | 'av1' | 'prores';

export interface RenderSettings {
  /** a rövidebb oldal pixelben: 480 / 720 / 1080 / 2160 / 4320 (8K) */
  resolution: number;
  fps: number;
  quality: 'low' | 'medium' | 'high';
  /** cél-kodek (alap: h264); av1/prores + 8K csak felhő-renderrel */
  codec?: RenderCodec;
  // ── Pro export-kontroll (a felhő-worker honorálja) ─────────────────────
  /** bitráta-mód: crf (minőség-alapú, alap) · vbr (cél + csúcs) · cbr (konstans) */
  bitrateMode?: 'crf' | 'vbr' | 'cbr';
  /** cél-bitráta Mbps-ban (vbr/cbr esetén; crf-nél nem használt) */
  bitrateMbps?: number;
  /** GOP (kulcskocka-táv) képkockában; hiányzó = fps×2 */
  gop?: number;
  /** szín-mélység: 8 (alap) vagy 10 bit */
  bitDepth?: 8 | 10;
  /** szín-tér: rec709 (alap, SDR) vagy rec2020 (széles gamut) */
  colorSpace?: 'rec709' | 'rec2020';
  /** HDR (PQ / SMPTE-2084) — 10-bit + rec2020 kényszerű */
  hdr?: boolean;
  /** hang mintavétel: 44100 / 48000 */
  sampleRate?: 44100 | 48000;
  /** hang csatorna-elrendezés: 1 (mono) / 2 (sztereó) */
  channels?: 1 | 2;
  /** false = belső render (mérés, album-szám): a worker nem küld „kész” értesítést */
  notify?: boolean;
  /** veszteségmentes hangexport bitmélysége (WAV/FLAC; alap 16, ditherrel) */
  audioBitDepth?: 16 | 24;
  /** hang bitráta kbps (alap 192) */
  audioBitrateKbps?: number;
  /** 🎧 HANG-ONLY export: a kész keverékből a worker ezt a formátumot vonja ki
   *  (WAV/MP3/AAC/FLAC/Opus). Hiányzó = normál videó-kimenet. */
  audioFormat?: 'wav' | 'mp3' | 'aac' | 'flac' | 'opus';
  /** 🎞️ GIF-export: a kész videóból animált GIF (palette-optimalizálva). */
  gif?: boolean;
  /** GIF képkocka/mp (5–30, alap 15) */
  gifFps?: number;
  /** GIF szélesség px (120–1080, alap 480) */
  gifWidth?: number;
}

/**
 * Igaz, ha a beállítás CSAK felhő-renderrel teljesíthető: az eszköz-render
 * H.264-et, 8-bitet, Rec.709-et és max 4K-t tud; az AV1/ProRes/HEVC, a 10-bit,
 * a HDR/Rec.2020 és a 8K a felhő-worker (ffmpeg) dolga.
 */
/** 📲 Platform export-presetek: a platform ajánlott kimeneti beállításai. */
export type ExportPlatform = 'tiktok' | 'reels' | 'shorts' | 'youtube' | 'instagram';
export const PLATFORM_PRESETS: Record<
  ExportPlatform,
  { label: string; aspect: string; settings: Partial<RenderSettings> }
> = {
  tiktok: {
    label: 'TikTok',
    aspect: '9:16',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
  reels: {
    label: 'Reels',
    aspect: '9:16',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
  shorts: {
    label: 'Shorts',
    aspect: '9:16',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
  youtube: {
    label: 'YouTube',
    aspect: '16:9',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 12 },
  },
  instagram: {
    label: 'Instagram',
    aspect: '4:5',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
};

export function settingsNeedCloud(s: RenderSettings): boolean {
  // Az eszközön futó (natív) render H.264/HEVC-et tud, cél-bitrátával (CRF vagy
  // VBR), 8-bit Rec.709, max 4K (Fázis A–E). Minden ezen túli pro-kontroll
  // (AV1/ProRes, 10-bit, HDR, Rec.2020, >4K, CBR, egyedi GOP) a felhő-workerre
  // kerül — hogy a UI ne ígérjen olyat, amit a lokális út elnyel.
  return (
    (s.codec !== undefined && s.codec !== 'h264' && s.codec !== 'hevc') ||
    s.resolution > 2160 ||
    s.bitDepth === 10 ||
    s.hdr === true ||
    s.colorSpace === 'rec2020' ||
    s.bitrateMode === 'cbr' ||
    (s.gop !== undefined && s.gop > 0)
  );
}

/**
 * Melyik motor rendereljen:
 *   • 'auto'  — ha az eszközön-render elérhető ÉS a projekt helyben renderelhető,
 *               akkor eszközön; különben felhő (Pro). Ez az alapértelmezett.
 *   • 'local' — kizárólag eszközön (nincs natív modul → hiba).
 *   • 'cloud' — kizárólag felhő (Pro-gate).
 */
export type RenderMode = 'auto' | 'local' | 'cloud';

export interface RenderOptions {
  mode?: RenderMode;
  /** megszakítás — a poll-ciklus és a hálózati hívások figyelik */
  signal?: AbortSignal;
}

export const DEFAULT_SETTINGS: RenderSettings = { resolution: 1080, fps: 30, quality: 'high', codec: 'h264' };
