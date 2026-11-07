import { isAudioTrack } from '@/lib/audioTracks';
import type { Project } from '@/types/project';

/**
 * 🎚️ A stem-export tiszta része: mely sávokból lesz stem (a hallható, klipet tartalmazó hangsávok,
 * a felület sorrendjében), és a fájlnevek a csomagban (sorszám + megjelenített név, fájlrendszer-
 * biztos, egyedi).
 */
export function stemSpecs(mix: Pick<Project, 'tracks'>, label: (type: string) => string): { track: string; name: string }[] {
  const used = new Set<string>();
  return mix.tracks
    .filter((t) => isAudioTrack(t.type) && t.clips.some((c) => c.kind === 'audio'))
    .map((t, i) => {
      const clean = label(t.type)
        .normalize('NFC')
        .replace(/[/\\:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40) || t.type;
      let name = `${String(i + 1).padStart(2, '0')} ${clean}`;
      for (let k = 2; used.has(name); k++) name = `${String(i + 1).padStart(2, '0')} ${clean} (${k})`;
      used.add(name);
      return { track: t.type, name };
    });
}

/** a tartomány fájlnév-utótagja: `_0m12s-0m30s` (mp-re kerekítve) */
export function rangeSuffix(from: number, to: number): string {
  const f = (s: number) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `_${f(from)}-${f(to)}`;
}
