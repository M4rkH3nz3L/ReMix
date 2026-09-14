/**
 * Káromkodás-szűrés a feliratokhoz (profanity replacement). A cél nem a teljes,
 * kimerítő lista, hanem a leggyakoribb erős szavak maszkolása (en/hu/de) —
 * platform-barát, „reklámbiztos" felirat. Szó-határon illeszt, kis/nagybetűre
 * érzéketlen, és megtartja a szó első betűjét maszkolásnál. Pure → tesztelhető.
 */

/** alap szólista (mag; a hívó bővítheti). Kisbetűs, ékezetes formában. */
export const PROFANITY_WORDS = [
  // en
  'fuck',
  'fucking',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'dick',
  'cunt',
  // hu
  'bazd',
  'bazmeg',
  'baszd',
  'kurva',
  'geci',
  'fasz',
  'faszom',
  'picsa',
  'szar',
  // de
  'scheisse',
  'arschloch',
  'fotze',
] as const;

export type ProfanityMode = 'mask' | 'stars' | 'remove';

/** egy szó maszkolása a mód szerint */
function maskWord(word: string, mode: ProfanityMode): string {
  if (mode === 'remove') {
    return '';
  }
  if (mode === 'stars') {
    return '*'.repeat(Math.max(3, word.length));
  }
  // 'mask': első betű + csillagok (f***)
  return word[0] + '*'.repeat(Math.max(2, word.length - 1));
}

/**
 * Egy szövegben lecseréli a tiltólistás szavakat. Unicode szó-határon illeszt
 * (az ékezetes magyar betűket is szónak veszi), és a szó kis/nagybetűs alakját
 * megőrzi a maszk kezdőbetűjében. Visszaadja az új szöveget + a cserék számát.
 */
export function replaceProfanity(
  text: string,
  mode: ProfanityMode = 'mask',
  words: readonly string[] = PROFANITY_WORDS
): { text: string; count: number } {
  let count = 0;
  // hosszabb szavak előbb (a „fucking" előbb, mint a „fuck")
  const sorted = [...words].sort((a, b) => b.length - a.length);
  // \p{L}: bármely betű (ékezetes is); a szó a listás tő + tetszőleges betű-farok
  let out = text;
  for (const w of sorted) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escapeRegExp(w)}\\p{L}*)`, 'giu');
    out = out.replace(re, (match) => {
      count += 1;
      const masked = maskWord(match, mode);
      // az eredeti kezdőbetű nagybetűs voltát megtartjuk (mask módban)
      return mode === 'mask' && match[0] === match[0].toUpperCase()
        ? masked[0].toUpperCase() + masked.slice(1)
        : masked;
    });
  }
  // 'remove' után maradt dupla szóközök összevonása
  if (mode === 'remove') {
    out = out.replace(/\s{2,}/g, ' ').trim();
  }
  return { text: out, count };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
