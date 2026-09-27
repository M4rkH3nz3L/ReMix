/**
 * ✍️ Markdown-elemzés (S-WRITER — MASTER §9) — pure, expo-mentes segédek a
 * Writer Studióhoz (és bármely markdown-tartalomhoz): szó/karakter-számlálás,
 * olvasási idő, vázlat (heading-fa / TOC). Nincs render, nincs hálózat — csak
 * determinisztikus szöveg-analízis, teljesen tesztelhető.
 */

/** A markdown-jelölés lecsupaszítása sima szöveggé (a számláláshoz). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // körülkerített kódblokk
    .replace(/`[^`]*`/g, ' ') // inline kód
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // képek
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // linkek → csak a szöveg
    .replace(/^\s{0,3}(#{1,6})\s+/gm, '') // heading-jelölők
    .replace(/[*_~>#|]/g, ' ') // formázó jelek + tábla-csövek
    .replace(/^\s*[-+]\s+/gm, ' ') // lista-jelek
    .replace(/\s+/g, ' ')
    .trim();
}

/** Szószám (a markdown-jelölés nélkül). */
export function wordCount(md: string): number {
  const s = stripMarkdown(md);
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

/** Karakterszám (a markdown-jelölés nélkül, szóközökkel együtt). */
export function charCount(md: string): number {
  return stripMarkdown(md).length;
}

/** Becsült olvasási idő percben (alapból 200 szó/perc); üres szövegre 0. */
export function readingTimeMin(words: number, wpm = 200): number {
  if (words <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(words / wpm));
}

export interface OutlineItem {
  /** heading-szint 1–6 */
  level: number;
  text: string;
  /** a heading sor-indexe (0-alapú) */
  line: number;
}

/**
 * A heading-vázlat (TOC) kinyerése. A körülkerített kódblokkokon belüli
 * `#`-eket NEM veszi headingnek.
 */
export function extractOutline(md: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const lines = md.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const m = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      out.push({ level: m[1].length, text: m[2].trim(), line: i });
    }
  }
  return out;
}
