/** 🏷️ Hashtag- és kulcsszó-lista bontása (a projekt SEO-mezőihez). */

/** közös: trimmelt, üres- és duplikátum-mentes tokenlista (kis/nagybetű-érzéketlen). */
function dedupeTokens(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/** „#viral, fun  travel" → ['viral','fun','travel'] — `#` nélkül, szó/vessző mentén. */
export function parseHashtags(input: string): string[] {
  return dedupeTokens(input.replace(/#/g, ' ').split(/[\s,]+/));
}

/** „főzés, gyors recept" → ['főzés','gyors recept'] — vesszős lista (szóköz megengedett). */
export function parseKeywords(input: string): string[] {
  return dedupeTokens(input.split(','));
}
