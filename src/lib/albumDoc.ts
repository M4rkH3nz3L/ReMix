/**
 * 🎧💿 Album-dokumentum mag (Hang Stúdió) — pure + tesztelt.
 *
 * A hang-projekt EGY album: több, külön szerkeszthető SZÁM (`AlbumSong`, mindegyik teljes
 * idővonal) + egy BORÍTÓ (`ImageDoc` a kép-szerkesztőből). Ez a mag az album-manifeszt
 * CRUD-logikáját adja (add/remove/reorder/rename/cover/active); a tényleges idővonal-csere
 * (az aktív szám `project.tracks`-ba töltése/kimentése) az `APPLY_ALBUM` command dolga.
 *
 * SZÁNDÉKOSAN expo-mentes (csak típus-import) → tesztelhető. A `reorderPages`-mintát követi.
 */
import type { AlbumDoc, AlbumSong, Asset, Track } from '@/types/project';
import { buildAlbum, type AlbumManifest, type AlbumTrack } from './album';

/** Album inicializálása a JELENLEGI idővonalból (az első szám = a mostani project.tracks). */
export function initAlbum(firstSong: AlbumSong): AlbumDoc {
  return { songs: [firstSong], activeSongId: firstSong.id };
}

/** Üres szám-váz (a hívó adja a kanonikus üres sávokat — `createEmptyProject` audio). */
export function makeSong(id: string, name: string, tracks: Track[], assets: Asset[] = []): AlbumSong {
  return { id, name, tracks, assets };
}

export function songCount(album: AlbumDoc | undefined): number {
  return album?.songs.length ?? 0;
}

/** Törölhető-e szám (legalább egynek maradnia kell). */
export function canRemoveSong(album: AlbumDoc | undefined): boolean {
  return songCount(album) > 1;
}

/** Az aktívan szerkesztett szám (vagy null). */
export function activeSong(album: AlbumDoc | undefined): AlbumSong | null {
  if (!album) {
    return null;
  }
  return album.songs.find((s) => s.id === album.activeSongId) ?? album.songs[0] ?? null;
}

/** Új szám hozzáadása a VÉGÉRE + az új számra váltás (az aktív snapshotja az APPLY_ALBUM-ban). */
export function addSong(album: AlbumDoc, song: AlbumSong): AlbumDoc {
  return { ...album, songs: [...album.songs, song], activeSongId: song.id };
}

/**
 * Szám törlése. A legalább-egy invariáns védi (no-op, ha az utolsót törölnéd). Ha az aktívat
 * törlöd, a szomszéd (előző, különben első) lesz az aktív.
 */
export function removeSong(album: AlbumDoc, songId: string): AlbumDoc {
  if (!canRemoveSong(album)) {
    return album;
  }
  const idx = album.songs.findIndex((s) => s.id === songId);
  if (idx < 0) {
    return album;
  }
  const songs = album.songs.filter((s) => s.id !== songId);
  let activeSongId = album.activeSongId;
  if (album.activeSongId === songId) {
    const neighbor = album.songs[idx - 1] ?? songs[0];
    activeSongId = neighbor.id;
  }
  return { ...album, songs, activeSongId };
}

/** Számok átrendezése (from → to index). Érvénytelen/azonos → no-op (eredeti referencia). */
export function reorderSongs(album: AlbumDoc, from: number, to: number): AlbumDoc {
  const n = album.songs.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) {
    return album;
  }
  const songs = album.songs.slice();
  const [moved] = songs.splice(from, 1);
  songs.splice(to, 0, moved);
  return { ...album, songs };
}

/** Szám átnevezése. Üres névre no-op. */
export function renameSong(album: AlbumDoc, songId: string, name: string): AlbumDoc {
  const trimmed = name.trim();
  if (!trimmed) {
    return album;
  }
  return { ...album, songs: album.songs.map((s) => (s.id === songId ? { ...s, name: trimmed } : s)) };
}

/** Aktív szám váltása (az idővonal-csere az APPLY_ALBUM-ban). Ismeretlen id → no-op. */
export function setActiveSong(album: AlbumDoc, songId: string): AlbumDoc {
  if (songId === album.activeSongId || !album.songs.some((s) => s.id === songId)) {
    return album;
  }
  return { ...album, activeSongId: songId };
}

/** Borító beállítása (egy ImageDoc id-ja a project.imageDocs-ból). null = borító eltávolítása. */
export function setCover(album: AlbumDoc, coverDocId: string | null): AlbumDoc {
  return { ...album, coverDocId: coverDocId ?? undefined };
}

/** A renderelt szám-fájl + hossz beírása (a megosztás előtti rasterizálás/render eredménye). */
export function setSongRender(album: AlbumDoc, songId: string, uri: string, durationSec: number): AlbumDoc {
  return {
    ...album,
    songs: album.songs.map((s) => (s.id === songId ? { ...s, renderedUri: uri, durationSec } : s)),
  };
}

/** Hány számnak van már renderelt hangja (a megosztáshoz). */
export function renderedSongCount(album: AlbumDoc | undefined): number {
  return (album?.songs ?? []).filter((s) => !!s.renderedUri).length;
}

/**
 * Album-manifeszt a megosztáshoz (az `album.ts` `buildAlbum`-jára építve): CSAK a renderelt
 * számok kerülnek be, a megadott (feltöltött) borító-URI-val. A számok sorrendje az album-sorrend.
 */
export function albumManifest(album: AlbumDoc | undefined, coverUri?: string): AlbumManifest {
  const tracks: AlbumTrack[] = (album?.songs ?? [])
    .filter((s) => !!s.renderedUri)
    .map((s) => ({ id: s.id, uri: s.renderedUri as string, title: s.name, durationSec: s.durationSec ?? 0 }));
  return buildAlbum(tracks, coverUri);
}
