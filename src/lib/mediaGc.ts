/**
 * 🧹 Projekt-média szemétgyűjtés — tiszta mag (ADR-013 kiegészítés).
 *
 * Termék-szabály: a projekt-média az APP tárolja (`document/media`,
 * `document/mediacache`) — a user a fájlt CSAK a projekttel együtt törli.
 * Projekt-törléskor a projekt (és verziói/recovery-je) által hivatkozott
 * app-média fájlok törölhetők, DE csak akkor, ha SEMMILYEN másik tárolt
 * dokumentum (projekt, verzió, recovery, eseménynapló) nem hivatkozik rájuk —
 * a duplikált/remixelt projektek ugyanis ugyanazokat a fájlokat osztják.
 *
 * Az összevetés NYERS JSON-szövegen, fájl-KULCS alapján megy (`media/<név>`),
 * nem teljes URI-n: iOS-en az app-konténer abszolút útvonala újratelepítéskor
 * változik, így a régi konténer-prefixű hivatkozás is ugyanazt a fájlt védi.
 * Expo-mentes, tiszta → önmagában tesztelt; az FS-törlés a `mediaGcClient`-ben.
 */

/** az app-kezelt (lapos) média-mappák (a `Paths.document` alatt) */
const APP_MEDIA_DIRS = ['media', 'mediacache'] as const;
/** `Files` = a projekt-mappák (`Files/Projektek/<folder>/…`) — a név itt al-utat is tartalmaz */
export type AppMediaDir = (typeof APP_MEDIA_DIRS)[number] | 'Files';

export interface MediaFileKey {
  dir: AppMediaDir;
  /** fájlnév a mappán belül (`media`/`mediacache` lapos; `Files`-nál `Projektek/<folder>/<út>`) */
  name: string;
}

/** kulcs-string a halmaz-műveletekhez */
function keyString(k: MediaFileKey): string {
  return `${k.dir}/${k.name}`;
}

/**
 * Egy URI app-média fájl-kulcsa, vagy `null`, ha nem app-tárolt média
 * (http/ph:// forrás, más mappa). Konténer-útvonal-független.
 */
export function mediaFileKeyOf(uri: string): MediaFileKey | null {
  if (!/^file:\/\//i.test(uri)) {
    return null;
  }
  // 📁 projekt-mappás fájl: `…/Files/Projektek/<folder>/<út>` (konténer-független)
  const pm = uri.match(/\/Files\/(Projektek\/[^"'\\]+)$/);
  if (pm) {
    let name = pm[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      // marad a nyers név
    }
    return name.includes('..') ? null : { dir: 'Files', name };
  }
  for (const dir of APP_MEDIA_DIRS) {
    const m = uri.match(new RegExp(`/${dir}/([^/\\\\"']+)$`));
    if (m && m[1].length > 0) {
      return { dir, name: decodeURIComponent(m[1]) };
    }
  }
  return null;
}

/**
 * Minden app-média fájl-kulcs kigyűjtése nyers (JSON) szövegből — séma-független:
 * az asset-uri, klip-uri, verzió-pillanatkép és eseménynapló hivatkozásait is
 * ugyanaz a minta fogja meg.
 */
export function extractMediaKeys(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) {
    return out;
  }
  for (const uri of raw.match(/file:\/\/[^"\\]+/g) ?? []) {
    const key = mediaFileKeyOf(uri);
    if (key) {
      out.add(keyString(key));
    }
  }
  return out;
}

/**
 * App-média hivatkozások URI→kulcs párokként (a `.rp` csomag-export bemenete):
 * minden EGYEDI app-média uri a hozzá tartozó fájl-kulccsal. Séma-független
 * (nyers JSON-szövegen megy, mint az `extractMediaKeys`).
 */
export function extractMediaUriEntries(
  raw: string | null | undefined,
): { uri: string; key: MediaFileKey }[] {
  const out = new Map<string, MediaFileKey>();
  if (!raw) {
    return [];
  }
  for (const uri of raw.match(/file:\/\/[^"\\]+/g) ?? []) {
    if (!out.has(uri)) {
      const key = mediaFileKeyOf(uri);
      if (key) {
        out.set(uri, key);
      }
    }
  }
  return [...out.entries()].map(([uri, key]) => ({ uri, key }));
}

/**
 * Törlés-terv: a törölt dokumentumokban hivatkozott app-média fájlok, amikre a
 * MEGMARADÓ dokumentumok egyike sem hivatkozik. Determinista, duplikátum-mentes.
 */
export function planMediaDeletion(
  deletedRaw: readonly (string | null | undefined)[],
  remainingRaw: readonly (string | null | undefined)[],
): MediaFileKey[] {
  const candidates = new Set<string>();
  for (const raw of deletedRaw) {
    for (const k of extractMediaKeys(raw)) {
      candidates.add(k);
    }
  }
  if (candidates.size === 0) {
    return [];
  }
  const referenced = new Set<string>();
  for (const raw of remainingRaw) {
    for (const k of extractMediaKeys(raw)) {
      referenced.add(k);
    }
  }
  const out: MediaFileKey[] = [];
  for (const k of candidates) {
    if (!referenced.has(k)) {
      const [dir, ...rest] = k.split('/');
      out.push({ dir: dir as AppMediaDir, name: rest.join('/') });
    }
  }
  return out.sort((a, b) => keyString(a).localeCompare(keyString(b)));
}
