/**
 * 📡 Multi-platform publishing — platform-adapter mag (audit §4.9).
 *
 * Tiszta, expo-mentes mag: egy posztot (cím + leírás + hashtagek + képarány +
 * hossz) a cél-platform SZABÁLYAIHOZ igazít (cím/leírás-limit, hashtag-plafon,
 * ajánlott képarány, short-form max hossz), és figyelmeztet, ha valamit vágni
 * kellett vagy a platform elutasíthatja. Így a feltöltés ELŐTT látszik, mi
 * megy fel pontosan — nem a szerver dobja vissza utólag.
 *
 * A tényleges OAuth + feltöltés + státusz/retry a backend (§4.9) — ez a determinisztikus,
 * tesztelt előkészítő, amit a preview-UI és a worker-publisher is használ.
 */

export type PublishPlatform = 'tiktok' | 'instagram' | 'youtube' | 'facebook';

export interface PlatformSpec {
  id: PublishPlatform;
  label: string;
  /** külön CÍM-mező max hossza (0 = nincs külön cím → a caption/leírás viszi) */
  maxTitle: number;
  /** a leírás/caption max hossza */
  maxDescription: number;
  /** a HATÉKONY hashtagek max száma (fölötte a platform figyelmen kívül hagyhatja) */
  maxHashtags: number;
  /** ajánlott képarány (short-form) */
  preferredAspect: string;
  /** short-form max hossz másodpercben (fölötte más felületre/feldolgozásra kerül) */
  maxDurationSec: number;
  /** a hashtagek a leírásba fűződnek-e */
  hashtagsInDescription: boolean;
}

/**
 * Platform-specifikációk (ésszerű, short-form-fókuszú közelítés). Hangolható —
 * a pontos limitek platformonként változhatnak; a mag a limitekre általánosan hat.
 */
export const PLATFORM_SPECS: Record<PublishPlatform, PlatformSpec> = {
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    maxTitle: 0,
    maxDescription: 2200,
    maxHashtags: 30,
    preferredAspect: '9:16',
    maxDurationSec: 600,
    hashtagsInDescription: true,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram Reels',
    maxTitle: 0,
    maxDescription: 2200,
    maxHashtags: 30,
    preferredAspect: '9:16',
    maxDurationSec: 90,
    hashtagsInDescription: true,
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube Shorts',
    maxTitle: 100,
    maxDescription: 5000,
    maxHashtags: 15,
    preferredAspect: '9:16',
    maxDurationSec: 60,
    hashtagsInDescription: true,
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook Reels',
    maxTitle: 0,
    maxDescription: 2200,
    maxHashtags: 30,
    preferredAspect: '9:16',
    maxDurationSec: 90,
    hashtagsInDescription: true,
  },
};

export const PUBLISH_PLATFORMS = Object.keys(PLATFORM_SPECS) as PublishPlatform[];

export interface PublishDraft {
  title?: string;
  description?: string;
  hashtags?: string[];
  aspectRatio?: string;
  durationSec?: number;
}

export type PublishWarningCode =
  | 'titleTruncated'
  | 'descriptionTruncated'
  | 'hashtagsDropped'
  | 'aspectMismatch'
  | 'durationExceeds';

export interface PublishWarning {
  code: PublishWarningCode;
  /** rövid, ember-olvasható részlet (pl. „120→100") */
  detail: string;
}

export interface PlatformVariant {
  platform: PublishPlatform;
  title: string;
  description: string;
  hashtags: string[];
  warnings: PublishWarning[];
}

/**
 * Hashtag normalizálása: vezető `#`-ek + nem alfanumerikus/`_` karakterek
 * eldobva, majd egyetlen `#` elé. Üres/érvénytelen → `null` (kiesik).
 */
export function normalizeHashtag(tag: string): string | null {
  const cleaned = tag
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return cleaned ? `#${cleaned}` : null;
}

/** Normalizált, duplikátum-mentes (kis-nagybetű-érzéketlen) hashtag-lista. */
export function normalizeHashtags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const n = normalizeHashtag(raw);
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      out.push(n);
    }
  }
  return out;
}

function truncate(s: string, max: number): string {
  if (max <= 0) {
    return '';
  }
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Egy poszt a cél-platform szabályaihoz igazítva (+ figyelmeztetések). A
 * szöveg-limiteket KEMÉNYEN betartja (vág, és jelzi); az aspect/hossz csak
 * figyelmeztet (a platform reframe-elhet vagy más felületre tehet).
 */
export function adaptForPlatform(draft: PublishDraft, platform: PublishPlatform): PlatformVariant {
  const spec = PLATFORM_SPECS[platform];
  const warnings: PublishWarning[] = [];

  // hashtagek: normalizálva + plafonra vágva
  let hashtags = normalizeHashtags(draft.hashtags);
  if (hashtags.length > spec.maxHashtags) {
    warnings.push({ code: 'hashtagsDropped', detail: `${hashtags.length}→${spec.maxHashtags}` });
    hashtags = hashtags.slice(0, spec.maxHashtags);
  }

  // cím: külön mező (ha a platformnak van), különben a leírás elejére kerül
  let title = (draft.title ?? '').trim();
  if (spec.maxTitle > 0 && title.length > spec.maxTitle) {
    warnings.push({ code: 'titleTruncated', detail: `${title.length}→${spec.maxTitle}` });
    title = truncate(title, spec.maxTitle);
  }

  let description = (draft.description ?? '').trim();
  if (spec.maxTitle === 0 && title) {
    description = description ? `${title}\n\n${description}` : title;
    title = '';
  }

  // hashtag-sor a leírás végére (ha a platform így kezeli); helyet tartunk neki a limitből
  const tagLine = spec.hashtagsInDescription && hashtags.length ? hashtags.join(' ') : '';
  const reserved = tagLine ? tagLine.length + 2 : 0; // +2 a "\n\n" elválasztóra (konzervatív)
  if (description.length + reserved > spec.maxDescription) {
    const budget = Math.max(0, spec.maxDescription - reserved);
    warnings.push({ code: 'descriptionTruncated', detail: `${description.length}→${budget}` });
    description = truncate(description, budget);
  }
  if (tagLine) {
    description = description ? `${description}\n\n${tagLine}` : tagLine;
  }

  // aspect + hossz: csak figyelmeztetés
  if (draft.aspectRatio && draft.aspectRatio !== spec.preferredAspect) {
    warnings.push({ code: 'aspectMismatch', detail: `${draft.aspectRatio}≠${spec.preferredAspect}` });
  }
  if (draft.durationSec != null && draft.durationSec > spec.maxDurationSec) {
    warnings.push({
      code: 'durationExceeds',
      detail: `${Math.round(draft.durationSec)}s>${spec.maxDurationSec}s`,
    });
  }

  return { platform, title, description, hashtags, warnings };
}

/** A poszt minden (vagy a megadott) platformra igazítva. */
export function adaptAll(draft: PublishDraft, platforms: PublishPlatform[] = PUBLISH_PLATFORMS): PlatformVariant[] {
  return platforms.map((p) => adaptForPlatform(draft, p));
}
