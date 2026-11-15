/**
 * 📐 Kiegyenesítés (IMAGE-PROD S18) — pure. A fotó TARTALMA a dobozán belül `deg` fokkal elfordul
 * (pozitív = óramutató szerint), és annyira nagyítódik, hogy a doboz sarkaiban ne maradjon üres rész
 * (Photoshop „kiegyenesítés + automatikus vágás”). Roncsolásmentes: a szög bármikor visszaállítható.
 * A szerver `straightenChain`-je (`server/imageFilters.js`) ugyanezt a képletet használja (contract-teszt).
 */

/** a megengedett szög (fok) */
export const STRAIGHTEN_MAX = 45;

/** a nagyítás, amivel a `w`×`h` (képpont) doboz az elforgatott tartalommal teljesen fedett */
export function straightenZoom(w: number, h: number, deg: number): number {
  const a = (Math.min(STRAIGHTEN_MAX, Math.abs(deg)) * Math.PI) / 180;
  if (a === 0 || w <= 0 || h <= 0) return 1;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  // a doboz sarka az elforgatott (k-szorosra nagyított) tartalmon belül van mindkét tengelyen
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}
