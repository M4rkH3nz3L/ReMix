/**
 * 🏷️ Más platformról letöltött forrás felismerése (PRO-VIDEO-EDITOR D11) — pure.
 *
 * A letöltő-appok (SnapTik, SSSTik, SaveFrom, …) és a platformok saját mentései
 * felismerhető fájlnevet adnak, a videóban pedig ott a platform VÍZJELE (pl. TikTok-logó
 * + felhasználónév). Import után egy figyelmeztetés: a más alkotó tartalma jogilag nem
 * a tiéd, és a vízjeles videót a platformok visszasorolják. Heurisztika — nem tiltás.
 */
export type SourcePlatform = 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'snapchat' | 'capcut';

const PATTERNS: [SourcePlatform, RegExp][] = [
  ['tiktok', /tik[\s_-]?tok|snaptik|ssstik|musicallydown|tikmate|ttdown|douyin/i],
  ['instagram', /instagram|insta[\s_-]?(save|down|reel)|igram|snapinsta|\breels?[\s_-]?\d/i],
  ['youtube', /youtube|\byt[\s_-]?(short|dl|down)|savefrom|y2mate|ssyoutube/i],
  ['facebook', /facebook|\bfb[\s_-]?(video|down)|fdown/i],
  ['snapchat', /snapchat/i],
  ['capcut', /capcut/i],
];

/** a forrás neve / uri-ja alapján a valószínű származási platform (vagy null) */
export function sourcePlatformOf(nameOrUri: string | undefined | null): SourcePlatform | null {
  if (!nameOrUri) return null;
  let base = nameOrUri.split('/').pop() ?? nameOrUri;
  try {
    base = decodeURIComponent(base);
  } catch {
    // hibás %-kódolás → a nyers név marad
  }
  for (const [platform, re] of PATTERNS) {
    if (re.test(base)) return platform;
  }
  return null;
}
