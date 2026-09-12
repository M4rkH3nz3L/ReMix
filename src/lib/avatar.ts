/**
 * 🧑‍🎨 Avatar-config — a felhasználó ÁLTAL összerakott karakter (nem fix emoji):
 * a vonásokat (bőrszín, haj-forma/szín, arc-kifejezés, kiegészítő, háttér) a user
 * választja, és SVG-ből (AvatarSvg) renderelődik. Minden vonás egy index az adott
 * opció-készletbe → tömör, szerializálható (jsonb), skálázható.
 */

export interface AvatarConfig {
  /** bőrszín index (SKIN_TONES) — teljes skála, világos→sötét */
  skin: number;
  /** haj-forma index (0 = nincs) */
  hair: number;
  /** haj-szín index (HAIR_COLORS) */
  hairColor: number;
  /** arc-kifejezés index */
  face: number;
  /** kiegészítő index (0 = nincs) */
  accessory: number;
  /** háttér-szín index (BG_COLORS) */
  bg: number;
}

/** teljes bőrszín-skála (világos → sötét) — sokféleséghez */
export const SKIN_TONES = ['#ffe0c4', '#f1c9a5', '#e0ac83', '#c68642', '#8d5524', '#5a3720', '#3b2416'];
export const HAIR_COLORS = ['#1b1b1b', '#4a2f1b', '#8a4b2a', '#d9a441', '#e7d9c4', '#b7b7b7', '#ff5ca8', '#5a9bff', '#2ecc8f'];
export const BG_COLORS = ['#7c5cff', '#4a9eff', '#2ecc8f', '#ffb454', '#ff5ca8', '#ff6b6b', '#2a2f3a', '#e7e7ef'];

/** a forma-vonások darabszáma (a builder ezeken lépked) */
export const HAIR_STYLES = 6; // 0 nincs · 1 rövid · 2 hosszú · 3 konty · 4 tüskés · 5 sapka-vonal
export const FACES = 5; // kifejezések
export const ACCESSORIES = 6; // 0 nincs · 1 szemüveg · 2 napszemüveg · 3 kalap · 4 fejhallgató · 5 fülbevaló

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: 2,
  hair: 1,
  hairColor: 0,
  face: 0,
  accessory: 0,
  bg: 0,
};

const ri = (n: number): number => Math.floor(Math.random() * n);

/** véletlen karakter (a builder „meglepetés" gombja) */
export function randomAvatar(): AvatarConfig {
  return {
    skin: ri(SKIN_TONES.length),
    hair: ri(HAIR_STYLES),
    hairColor: ri(HAIR_COLORS.length),
    face: ri(FACES),
    accessory: ri(ACCESSORIES),
    bg: ri(BG_COLORS.length),
  };
}

/** ciklikus léptetés egy vonáson (a builder ◀ ▶ gombjaihoz) */
export function cycle(value: number, len: number, dir: 1 | -1): number {
  return (value + dir + len) % len;
}

/** ismeretlen/hiányos configot biztonságos alapértékekre hoz */
export function normalizeAvatar(raw: unknown): AvatarConfig {
  const o = (raw ?? {}) as Partial<AvatarConfig>;
  const clamp = (v: unknown, len: number, d: number) =>
    typeof v === 'number' && v >= 0 && v < len ? Math.floor(v) : d;
  return {
    skin: clamp(o.skin, SKIN_TONES.length, DEFAULT_AVATAR.skin),
    hair: clamp(o.hair, HAIR_STYLES, DEFAULT_AVATAR.hair),
    hairColor: clamp(o.hairColor, HAIR_COLORS.length, DEFAULT_AVATAR.hairColor),
    face: clamp(o.face, FACES, DEFAULT_AVATAR.face),
    accessory: clamp(o.accessory, ACCESSORIES, DEFAULT_AVATAR.accessory),
    bg: clamp(o.bg, BG_COLORS.length, DEFAULT_AVATAR.bg),
  };
}
