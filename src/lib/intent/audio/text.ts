/** 🔤 Szöveg-előkészítés: normalizálás, idézet, szám, tagmondatokra bontás. */

/** kisbetű, ékezet nélkül */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export const quoted = (raw: string) => raw.match(/[„"“']([^„"”“']{1,60})["”“']/)?.[1]?.trim() || null;
export const num = (s: string) => Number(s.replace(',', '.'));

/** a mondat tagmondatai (a vessző/pontosvessző és a kötőszavak mentén; az idézet egyben marad) */
export function splitClauses(raw: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  const words = raw.split(/(\s+)/);
  for (const w of words) {
    const q = (w.match(/[„"“”]/g) ?? []).length;
    const bare = norm(w.replace(/[,;.!?]+$/, ''));
    if (!inQuote && ['es', 'majd', 'aztan', 'utana', 'and', 'then', 'und', 'dann'].includes(bare)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += w;
    if (q % 2 === 1) inQuote = !inQuote;
    if (!inQuote && /[,;]$/.test(w)) {
      parts.push(cur.replace(/[,;]$/, '').trim());
      cur = '';
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}
