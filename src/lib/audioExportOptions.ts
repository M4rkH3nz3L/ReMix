import type { RenderSettings } from '@/lib/render';
import type { AudioMasterTarget } from '@/types/project';

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

// ── 🎯 V12: creator-profil az exportnál — a hangosság-cél a formátumot is javasolja ──────────────


export interface ProfileExport {
  format: AudioExportFormat;
  quality: AudioExportQuality;
}

/** a profil szerint javasolt formátum (a platformok bevett szállítási formátumai); `custom` → nincs javaslat */
export function profileExport(target: AudioMasterTarget | undefined): ProfileExport | null {
  switch (target) {
    case 'podcast':
      return { format: 'mp3', quality: { bitrateKbps: 128, bitDepth: 16, sampleRate: 44100, channels: 1 } };
    case 'music':
    case 'spotify':
    case 'club':
      return { format: 'wav', quality: { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 } };
    case 'appleMusic':
      return { format: 'wav', quality: { bitrateKbps: 0, bitDepth: 24, sampleRate: 48000, channels: 2 } };
    case 'video':
    case 'youtube':
    case 'social':
    case 'tiktok':
      return { format: 'aac', quality: { bitrateKbps: 256, bitDepth: 16, sampleRate: 48000, channels: 2 } };
    default:
      return null;
  }
}

/**
 * a telefonos (Free) export ma egyetlen formát ír: WAV 44,1 kHz, sztereó, 16 bit (`exportOfflineWav`) — a
 * javaslat ezt mutatja, nem ígér mást (a profil mintavétele/csatornája a Pro felhő-exportnál érvényes)
 */
export function profileExportOnDevice(_p: ProfileExport): ProfileExport {
  return { format: 'wav', quality: { bitrateKbps: 0, bitDepth: 16, sampleRate: 44100, channels: 2 } };
}

/** a mért integrált hangosság a cél tartományában (±1 LU) — a felület visszajelzése */
export function loudnessVerdict(measuredLufs: number | null | undefined, targetLufs: number): 'ok' | 'quiet' | 'loud' | null {
  if (measuredLufs === null || measuredLufs === undefined || !Number.isFinite(measuredLufs)) return null;
  if (measuredLufs < targetLufs - 1) return 'quiet';
  if (measuredLufs > targetLufs + 1) return 'loud';
  return 'ok';
}
