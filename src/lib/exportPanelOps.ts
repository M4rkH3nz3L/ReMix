/**
 * 📤 A videó-export panel (src/components/editor/panels/ExportPanel.tsx) tiszta,
 * expo-mentes magja: a chip-opciók, a méret-becslés és a chipek → RenderSettings
 * leképezés. A panelből kiemelve.
 */
import type { RenderSettings } from '@/lib/render';

export const RESOLUTIONS = [
  { label: '480p', value: 480 },
  { label: '720p', value: 720 },
  { label: '1080p', value: 1080 },
  { label: '4K', value: 2160 },
  { label: '8K', value: 4320 },
] as const;
export const FPS_OPTIONS = [24, 30, 60] as const;
export const QUALITIES = [
  { id: 'low' },
  { id: 'medium' },
  { id: 'high' },
] as const;
/** kodekek (a nevek fixek); az AV1/ProRes csak felhő-render (Pro) */
export const CODECS = [
  { id: 'h264', label: 'H.264' },
  { id: 'hevc', label: 'HEVC' },
  { id: 'av1', label: 'AV1' },
  { id: 'prores', label: 'ProRes' },
] as const;

/** hozzávetőleges bitráta (Mbps) felbontás + minőség szerint, 30 fps-re */
export const BASE_MBPS: Record<number, number> = { 480: 2.2, 720: 4.5, 1080: 8, 2160: 28, 4320: 90 };
export const QUALITY_MULT = { low: 0.55, medium: 1, high: 1.5 } as const;

export type ExportQuality = 'low' | 'medium' | 'high';
export type ExportCodec = 'h264' | 'hevc' | 'av1' | 'prores';
export type ExportBitrateMode = 'crf' | 'vbr' | 'cbr';
export type ExportColorMode = 'rec709' | 'rec2020' | 'hdr';

/** a panel chipjeinek pillanatnyi értékei (a render-beállítás forrása) */
export interface ExportChipValues {
  resolution: number;
  fps: number;
  quality: ExportQuality;
  codec: ExportCodec;
  bitrateMode: ExportBitrateMode;
  bitrateMbps: number;
  gop: number;
  bitDepth: 8 | 10;
  colorMode: ExportColorMode;
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
}

/** a várható fájlméret MB-ban: crf-nél a felbontás/minőség/fps becslése, különben a cél-bitráta */
export function estimateExportMb(
  durationSec: number,
  v: Pick<ExportChipValues, 'bitrateMode' | 'resolution' | 'quality' | 'fps' | 'bitrateMbps'>
): number {
  const { bitrateMode, resolution, quality, fps, bitrateMbps } = v;
  const mbps =
    bitrateMode === 'crf'
      ? (BASE_MBPS[resolution] ?? 8) * QUALITY_MULT[quality] * (0.35 + 0.65 * (fps / 30))
      : bitrateMbps;
  return (durationSec * mbps) / 8;
}

// az összes chip → egyetlen RenderSettings (a worker/natív render ezt kapja)
export function buildRenderSettings(v: ExportChipValues): RenderSettings {
  const { resolution, fps, quality, codec, bitrateMode, bitrateMbps, gop, bitDepth, colorMode, sampleRate, channels } = v;
  return {
    resolution,
    fps,
    quality,
    codec,
    bitrateMode,
    bitrateMbps: bitrateMode === 'crf' ? undefined : bitrateMbps,
    gop: gop > 0 ? gop : undefined,
    bitDepth: colorMode === 'hdr' ? 10 : bitDepth,
    colorSpace: colorMode === 'rec2020' ? 'rec2020' : 'rec709',
    hdr: colorMode === 'hdr',
    sampleRate,
    channels,
    audioBitrateKbps: 192,
  };
}

/** batch-kijelölés váltása: új halmaz (a régi érintetlen) */
export function toggleBatchPlatform<P>(prev: ReadonlySet<P>, p: P): Set<P> {
  const next = new Set(prev);
  next.has(p) ? next.delete(p) : next.add(p);
  return next;
}
