import type { Clip, TextClip } from '@/types/project';

/**
 * ✨ Caption Studio (P1) — pure rész: heurisztikus emphasis-fallback (AI
 * nélkül is működik) és a javaslatok alkalmazása a felirat-klipekre.
 * A hálózati AI-hívás a captionStudioClient.ts-ben.
 */

export interface CaptionSuggestion {
  id: string;
  /** kiemelendő szó-indexek (0-alapú, whitespace-bontás) */
  emphasis: number[];
  /** egy illő emoji vagy üres string */
  emoji: string;
}

/** kötőszavak/névelők/töltelékek — ezeket sosem emeljük ki */
const STOP = new Set([
  'a', 'az', 'egy', 'és', 'de', 'ha', 'hogy', 'is', 'nem', 'meg', 'el', 'ez',
  'azt', 'ezt', 'mi', 'te', 'ki', 'be', 'fel', 'le', 'majd', 'mert', 'mint',
  'the', 'and', 'but', 'for', 'with', 'this', 'that', 'you', 'your',
]);

/**
 * Heurisztikus emphasis: számok mindig; egyébként a leghosszabb tartalmas szó
 * (ha elég hosszú). Konzervatív: legfeljebb 2 kiemelés, rövid szövegre semmi.
 */
export function heuristicEmphasis(text: string): number[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) {
    return [];
  }
  const out: number[] = [];
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  words.forEach((w, i) => {
    if (/\d/.test(w)) {
      out.push(i);
    }
  });
  if (out.length < 2) {
    let bestIdx = -1;
    let bestLen = 6; // ennél hosszabb tartalmas szó kell
    words.forEach((w, i) => {
      const n = norm(w);
      if (!out.includes(i) && !STOP.has(n) && n.length > bestLen) {
        bestLen = n.length;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      out.push(bestIdx);
    }
  }
  return out.slice(0, 2).sort((a, b) => a - b);
}

/** fallback-javaslatok AI nélkül (emoji nem — azt csak az AI mer) */
export function heuristicSuggestions(
  clips: { id: string; text: string }[]
): CaptionSuggestion[] {
  return clips.map((c) => ({ id: c.id, emphasis: heuristicEmphasis(c.text), emoji: '' }));
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

/**
 * A javaslatok alkalmazása a felirat-sáv klip-listájára: emphasis-indexek
 * (érvényesség-szűrve), emoji a szöveg végére (ha még nincs benne emoji), és
 * az animáció karaoke-ra vált, ha eddig nem volt animálva.
 */
export function applyCaptionSuggestions(
  clips: Clip[],
  suggestions: CaptionSuggestion[]
): { clips: Clip[]; changed: number } {
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  let changed = 0;
  const out = clips.map((clip) => {
    if (clip.kind !== 'text') {
      return clip;
    }
    const s = byId.get(clip.id);
    if (!s) {
      return clip;
    }
    const wordCount = clip.text.split(/\s+/).filter(Boolean).length;
    const emphasis = [...new Set(s.emphasis)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < wordCount)
      .sort((a, b) => a - b)
      .slice(0, 2);
    const addEmoji =
      s.emoji && EMOJI_RE.test(s.emoji) && !EMOJI_RE.test(clip.text)
        ? ` ${s.emoji.trim()}`
        : '';
    if (emphasis.length === 0 && !addEmoji) {
      return clip;
    }
    changed += 1;
    const next: TextClip = {
      ...clip,
      text: clip.text + addEmoji,
      emphasis: emphasis.length > 0 ? emphasis : undefined,
      animation: clip.animation === 'none' ? 'karaoke' : clip.animation,
    };
    return next;
  });
  return { clips: out, changed };
}
