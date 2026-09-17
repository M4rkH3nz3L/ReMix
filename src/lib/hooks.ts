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
/**
 * A meglévő szöveg-klipek közé beteszi a hook-ot, a legelejére ragadt régi
 * hookot pedig eldobja.
 *
 * Generikus, mert korábban `TextClip[] | { kind; start }[]` uniót várt — emiatt
 * a hívónak MINDKÉT irányban `as never`-t kellett írnia. Így a bemeneti klip-típus
 * végigmegy a visszatérési értékig, és a hívóhelyen nincs szükség assertionre.
 */
export function replaceHookClips<C extends { kind: string; start: number }>(
  clips: readonly C[],
  hook: TextClip
): (C | TextClip)[] {
  const kept = clips.filter((c) => !(c.kind === 'text' && c.start < 0.05));
  return [hook, ...kept].sort((a, b) => a.start - b.start);
}
