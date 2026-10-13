/**
 * 🎧💿 Hang-album mag (TECH-TOP §2.3) — pure + tesztelt.
 *
 * A hang-projekt egy ALBUM: több rendered szám + egy BORÍTÓ (a kép-szerkesztővel szerkesztve).
 * A feedbe a TELJES album egy LAPOZHATÓ posztként megy (mint egy videó remixelésekor): az első
 * lap a borító, utána számonként egy-egy lap. (A 10 perc-plafon a VIDEÓ-é; az album nem korlátos.)
 */

export interface AlbumTrack {
  /** stabil azonosító */
  id: string;
  /** a rendered hang (uri) */
  uri: string;
  /** szám-cím */
  title?: string;
  /** hossz mp-ben */
  durationSec: number;
}

export interface AlbumManifest {
  tracks: AlbumTrack[];
  /** borító (a kép-szerkesztővel készült PNG) */
  coverUri?: string;
  count: number;
  /** teljes játékidő mp */
  totalSec: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Album összeállítása a rendezett számokból (+ borító). A sorrend = a megadott sorrend. */
export function buildAlbum(tracks: AlbumTrack[], coverUri?: string): AlbumManifest {
  const clean = (tracks ?? []).filter((t) => t && typeof t.uri === 'string' && t.uri.length > 0);
  const totalSec = round(clean.reduce((s, t) => s + Math.max(0, Number(t.durationSec) || 0), 0));
  return { tracks: clean, coverUri, count: clean.length, totalSec };
}

export type AlbumPage =
  | { kind: 'cover'; uri: string }
  | { kind: 'track'; id: string; uri: string; title: string; index: number };

/**
 * A feed-poszt LAPOZHATÓ lapjai (remix-pager-minta): elöl a borító (ha van), majd számonként
 * egy lap. A cím hiányában „N. szám" fallback.
 */
export function albumPagerItems(album: AlbumManifest): AlbumPage[] {
  const pages: AlbumPage[] = [];
  if (album.coverUri) {
    pages.push({ kind: 'cover', uri: album.coverUri });
  }
  album.tracks.forEach((t, i) => {
    pages.push({ kind: 'track', id: t.id, uri: t.uri, title: t.title || `${i + 1}. szám`, index: i });
  });
  return pages;
}

/** mm:ss formázás a teljes játékidőhöz. */
export function formatAlbumDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
