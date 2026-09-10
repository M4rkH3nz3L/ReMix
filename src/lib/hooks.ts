import type { TextClip } from '@/types/project';

/**
 * 🪝 Hook Generator (P2) — pure rész: a választott nyitómondatból cím-klip a
 * szöveg-sávra. Az első 2 másodperc dönt, ezért a hook a videó legelejére, a
 * felső harmadba kerül, pop-animációval és kontúros stílussal.
 */

export interface HookSuggestion {
  text: string;
  style: string;
}

/** a hook megjelenési hossza: rövid szövegnek elég 2 mp, hosszabbnak több */
export function hookDuration(text: string, projectDuration: number): number {
  const base = 2 + Math.min(1.5, Math.max(0, text.length - 20) * 0.05);
  return Math.max(1, Math.min(base, Math.max(1, projectDuration)));
}

export function buildHookClip(
  text: string,
  projectDuration: number,
  makeId: () => string
): TextClip {
  const clean = text.trim().replace(/^["„”]|["„”]$/g, '');
  return {
    kind: 'text',
    id: makeId(),
    start: 0,
    duration: hookDuration(clean, projectDuration),
    text: clean,
    color: '#ffffff',
    backgroundColor: null,
    fontSize: 8,
    fontWeight: 'bold',
    position: { x: 0.5, y: 0.24 },
    animation: 'pop',
    stylePreset: 'outline',
  };
}

/**
 * A szöveg-sáv új klip-listája: a korábbi hook (a 0-nál kezdődő cím) lecserélve
 * — így a variánsok próbálgatása nem halmoz fel klipeket.
 */
export function replaceHookClips(
  clips: TextClip[] | { kind: string; start: number }[],
  hook: TextClip
): (TextClip | { kind: string; start: number })[] {
  const kept = clips.filter((c) => !(c.kind === 'text' && c.start < 0.05));
  return [hook, ...kept].sort((a, b) => a.start - b.start);
}
