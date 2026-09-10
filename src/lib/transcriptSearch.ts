import type { TranscriptLine } from '@/lib/transcripts';
import type { SearchHit } from '@/lib/visionIndex';

/**
 * 📝 Átirat-kereső (P0‑8 bővítés): a Smart Search a kimondott szövegben is
 * keres — a vision-találatokkal egy listában. Egyszerű, determinisztikus
 * pontozás: a lekérdezés tokenjei hányad részben szerepelnek a sorban
 * (részszó-egyezés — a magyar ragozást így tűri). Pure, tesztelhető.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');

/** a lekérdezés érdemi tokenjei (a 2 betűsnél rövidebbek kiesnek) */
export function queryTokens(query: string): string[] {
  return norm(query)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export function searchTranscript(
  lines: TranscriptLine[],
  query: string,
  limit = 6
): SearchHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || lines.length === 0) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const line of lines) {
    const text = norm(line.text);
    const matched = tokens.filter((t) => text.includes(t)).length;
    if (matched === 0) {
      continue;
    }
    hits.push({
      time: line.start,
      uri: '',
      description: line.text,
      labels: ['átirat'],
      // teljes token-egyezés = 1; részleges arányosan (min. 1 token kell)
      score: Math.round((matched / tokens.length) * 100) / 100,
      source: 'transcript',
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.time - b.time).slice(0, limit);
}

/** vision + átirat találatok egy listában: pontszám szerint, korlátozva */
export function mergeSearchHits(
  vision: SearchHit[],
  transcript: SearchHit[],
  limit = 8
): SearchHit[] {
  return [...vision, ...transcript]
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .slice(0, limit);
}
