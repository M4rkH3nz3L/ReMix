/** 🎤 A diktálás javítása: számszavak → számjegy, félrehallott parancsszavak, a Whisper kezdő-promptja. */

/** számszavak (hu/en/de, 1–12) → számjegy, de CSAK mértékegység előtt („hat decibellel” → „6 decibellel”; az „egy kicsit” névelő marad) */
const NUMBER_WORDS: Record<string, number> = {
  // a „hadd” a „hat” gyakori félrehallása a diktálásban
  egy: 1, ket: 2, hadd: 6, ketto: 2, harom: 3, negy: 4, ot: 5, hat: 6, het: 7, nyolc: 8, kilenc: 9, tiz: 10, tizenegy: 11, tizenketto: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwolf: 12,
};
export function numberWordsToDigits(t: string): string {
  return t.replace(/\b([a-z]+)\s+(?=(db|decibel\w*|mp\b|masodperc\w*|sec\w*|seconds?\b|sekunde\w*|felhang\w*|semitone\w*|halbton\w*))/g, (m, w: string) =>
    NUMBER_WORDS[w] !== undefined ? `${NUMBER_WORDS[w]} ` : m
  );
}

/**
 * a diktálás félrehallásai ellen: a parancsszavak kanonikus alakja (ékezet nélkül). Egy szó akkor
 * igazodik ide, ha legfeljebb 1 (8+ betűnél 2) betűben tér el, vagy ha két szomszédos darabja
 * együtt adja ki („úszta sd” → „usztasd”). Rövid (5 betűnél kisebb) szót nem javít — a „hall” nem lesz „halk”.
 */
const KEYWORDS = [
  'halkuljon', 'halkitsd', 'halkabban', 'hangositsd', 'hangosabban', 'alatt', 'usztasd', 'beusztatas', 'kiusztatas',
  'zengest', 'visszhangot', 'kompresszort', 'zajszurest', 'normalizalast', 'masterelj', 'beszedre', 'beszedet', 'beszed',
  'zenet', 'zenere', 'effektet', 'effektre', 'masodperc', 'masodperc alatt', 'decibellel', 'tempo', 'markert', 'refren',
  'csendeket', 'ellenorizd', 'nemitsd',
];
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const closest = (w: string): string | null => {
  if (w.length < 5 || KEYWORDS.includes(w)) return null;
  const max = w.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const k of KEYWORDS) {
    const d = editDistance(w, k, max);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return bestD <= max ? best : null;
};
export function fixDictation(t: string): string {
  const words = t.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.,!?]+$/, '');
    const glued = i + 1 < words.length ? w + words[i + 1].replace(/[.,!?]+$/, '') : '';
    if (glued && (KEYWORDS.includes(glued) || (glued.length >= 6 && closest(glued) && !KEYWORDS.includes(w)))) {
      out.push(KEYWORDS.includes(glued) ? glued : closest(glued)!);
      i++;
      continue;
    }
    out.push(closest(w) ?? words[i]);
  }
  return out.join(' ');
}

/**
 * a Whisper kezdő-promptja a diktáláshoz: a parancsok szókincse (rövid, szakszavas mondatnál a
 * modell enélkül félrehall — mérve: „halkítsd” → „hall kicszd”)
 */
export const ASR_HINT =
  'Hangszerkesztés: zengés, visszhang, kompresszor, zajszűrés, de-esser, normalizálás, halkítsd, hangosítsd, decibel, zene, beszéd, effekt, master, Spotify, YouTube, LUFS, úsztasd be, marker, refrén, csendek, ütem. ' +
  'Audio editing: reverb, echo, compressor, noise reduction, louder, quieter, music, voice, master, fade in, marker, chorus.';
