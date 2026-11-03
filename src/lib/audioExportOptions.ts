import type { RenderSettings } from '@/lib/render';

/**
 * 🎧 Hangexport-beállítások (PRO-AUDIO A31): formátum, minőség, mintavétel, csatorna. Pure.
 * A veszteséges formátumok bitrátát, a veszteségmentesek bitmélységet kapnak; az alapértékek
 * a worker alapértékeivel egyeznek (`server/render.js` AUDIO_FORMATS).
 */
export type AudioExportFormat = NonNullable<RenderSettings['audioFormat']>;

export interface AudioExportQuality {
  bitrateKbps: number;
  bitDepth: 16 | 24;
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
}

export interface AudioExportFormatInfo {
  id: AudioExportFormat;
  label: string;
  ext: string;
  mime: string;
  lossy: boolean;
  bitrates: number[];
  defaultKbps: number;
}

export const AUDIO_EXPORT_FORMATS: AudioExportFormatInfo[] = [
  { id: 'mp3', label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', lossy: true, bitrates: [128, 192, 256, 320], defaultKbps: 192 },
  { id: 'wav', label: 'WAV', ext: 'wav', mime: 'audio/wav', lossy: false, bitrates: [], defaultKbps: 0 },
  { id: 'flac', label: 'FLAC', ext: 'flac', mime: 'audio/flac', lossy: false, bitrates: [], defaultKbps: 0 },
  { id: 'aac', label: 'AAC (M4A)', ext: 'm4a', mime: 'audio/mp4', lossy: true, bitrates: [128, 192, 256], defaultKbps: 256 },
  // a fájl .opus (Ogg-konténerben), a felirat ezért nem „OGG”
  { id: 'opus', label: 'Opus', ext: 'opus', mime: 'audio/ogg', lossy: true, bitrates: [96, 128, 192, 256], defaultKbps: 192 },
];

export function audioFormatInfo(format: AudioExportFormat): AudioExportFormatInfo {
  return AUDIO_EXPORT_FORMATS.find((f) => f.id === format) ?? AUDIO_EXPORT_FORMATS[0];
}

export function defaultAudioQuality(format: AudioExportFormat): AudioExportQuality {
  return { bitrateKbps: audioFormatInfo(format).defaultKbps, bitDepth: 16, sampleRate: 44100, channels: 2 };
}

/** Formátumváltásnál a bitráta az új formátum kínálatához igazodik, a többi marad. */
export function qualityForFormat(format: AudioExportFormat, prev: AudioExportQuality): AudioExportQuality {
  const info = audioFormatInfo(format);
  const bitrateKbps = info.bitrates.includes(prev.bitrateKbps) ? prev.bitrateKbps : info.defaultKbps;
  return { ...prev, bitrateKbps };
}

/** A render-beállítás a választásból (a worker csak a formátumhoz illő mezőt kapja). */
export function audioExportSettings(format: AudioExportFormat, q: AudioExportQuality): Partial<RenderSettings> {
  const info = audioFormatInfo(format);
  return {
    audioFormat: format,
    sampleRate: q.sampleRate,
    channels: q.channels,
    ...(info.lossy ? { audioBitrateKbps: q.bitrateKbps } : { audioBitDepth: q.bitDepth }),
  };
}

/** Fájlnév a projektnévből: a fájlrendszerben és megosztáskor is biztonságos. */
export function audioExportFileName(projectName: string, format: AudioExportFormat): string {
  const base =
    projectName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 _-]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'ReMix';
  return `${base}.${audioFormatInfo(format).ext}`;
}
