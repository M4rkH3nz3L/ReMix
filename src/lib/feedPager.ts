import type { FeedPost } from '@/types/social';

/**
 * 🔀 A feed vízszintes remix-lapozójának PURE magja (expo-mentes → tesztelhető).
 *
 * Egy TOP-poszt egy függőleges oldal, amin belül VÍZSZINTESEN lapozható az eredeti
 * (0. lap) + a hozzá csatolt remixek (1..N. lap, full-screen). Ez a modul számolja,
 * MELYIK poszt az aktív (a lejátszóhoz), és fordítja a scroll-eltolást lap-indexre.
 */

/** A vízszintes lapok: az eredeti poszt + a (már betöltött) remixei. */
export function remixPages(post: FeedPost, remixes: FeedPost[] | undefined): FeedPost[] {
  return remixes && remixes.length > 0 ? [post, ...remixes] : [post];
}

/** Csak a NYILVÁNOSAN látható (nem moderált-eltávolított) remixek kerülnek a lapozóba. */
export function visibleRemixes(remixes: FeedPost[]): FeedPost[] {
  return remixes.filter((r) => r.moderationStatus === 'ok');
}

/**
 * Az aktívan LÁTSZÓ/JÁTSZÓ poszt id-ja: az aktív TOP-poszt kiválasztott lapja
 * (0 = eredeti → maga a top-poszt, egyébként a megfelelő remix). Ha az index remix-re
 * mutat, de az (még) nincs betöltve, biztonságosan az eredetire esik vissza.
 */
export function resolveActiveId(
  activeTopId: string | null,
  pageIndex: Record<string, number>,
  remixes: FeedPost[] | undefined
): string | null {
  if (!activeTopId) {
    return null;
  }
  const idx = pageIndex[activeTopId] ?? 0;
  return idx > 0 && remixes?.[idx - 1] ? remixes[idx - 1].id : activeTopId;
}

/**
 * A vízszintes scroll-eltolásból (px) a lap-index — DE csak akkor, ha a lista már egy
 * lapra „beállt" (a küszöbön belül van). Mid-swipe (nem beállt) esetén `null`, hogy a
 * videó ne villódzzon félúton. Web + natív egyaránt így stabil.
 */
export function pageFromScroll(offsetX: number, contentW: number, threshold = 4): number | null {
  const w = Math.max(1, contentW);
  const idx = Math.max(0, Math.round(offsetX / w));
  return Math.abs(offsetX - idx * w) < threshold ? idx : null;
}
