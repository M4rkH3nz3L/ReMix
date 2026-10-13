/**
 * 🎧💿➡️📲 Album → FEED megosztás (Hang Stúdió) — pure + tesztelt.
 *
 * A hang-album (borító + több renderelt szám) a feedbe ALBUM-VIDEÓ-ként megy: a BORÍTÓ végig
 * látszik, alatta a számok EGYMÁS UTÁN szólnak (mint egy YouTube-album-feltöltés). A kimenet
 * szabványos videó-`Project`, amit a meglévő videó-render renderel (`publishRenderedProject`).
 * (A hosszú album a 10 perc-videó-plafonba ütközhet — az igazán hosszú albumhoz a lapozható
 * audio-album-kártya a következő lépés.)
 */
import type { AudioClip, ImageClip, Project } from '@/types/project';

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** A renderelt számok össz-hossza (mp) — a borító-klip és az album-videó hossza. */
export function albumTotalSec(project: Pick<Project, 'album'>): number {
  const songs = project.album?.songs ?? [];
  return round(songs.filter((s) => s.renderedUri).reduce((sum, s) => sum + Math.max(0, s.durationSec ?? 0), 0));
}

/** Megosztható-e albumként: van borító (renderelt PNG) ÉS legalább egy renderelt szám. */
export function canShareAlbum(project: Pick<Project, 'album' | 'imageDocs'>): boolean {
  const album = project.album;
  if (!album) {
    return false;
  }
  const hasSong = album.songs.some((s) => s.renderedUri);
  const cover = album.coverDocId ? project.imageDocs?.find((d) => d.id === album.coverDocId) : undefined;
  return hasSong && !!cover?.renderedUri;
}

/**
 * Az albumból ALBUM-VIDEÓ render-projekt: egy `video` sávon a borító EGY klipje a teljes
 * hosszra, egy `music` sávon a renderelt számok EGYMÁS UTÁN. `null`, ha nincs borító vagy
 * renderelt szám. A `rendered` cache ürítve (friss render).
 */
export function buildAlbumVideoProject(project: Project): Project | null {
  const album = project.album;
  if (!album) {
    return null;
  }
  const songs = album.songs.filter((s) => s.renderedUri);
  if (songs.length === 0) {
    return null;
  }
  const coverDoc = album.coverDocId ? project.imageDocs?.find((d) => d.id === album.coverDocId) : undefined;
  const coverUri = coverDoc?.renderedUri;
  if (!coverUri) {
    return null;
  }

  let cursor = 0;
  const audioClips: AudioClip[] = songs.map((s) => {
    const dur = Math.max(0, s.durationSec ?? 0);
    const clip: AudioClip = {
      kind: 'audio',
      id: `album-${s.id}`,
      start: round(cursor),
      duration: dur,
      uri: s.renderedUri as string,
      label: s.name,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      source: 'imported',
    };
    cursor += dur;
    return clip;
  });
  const totalSec = round(cursor);
  const coverClip: ImageClip = {
    kind: 'image',
    id: 'album-cover',
    start: 0,
    duration: totalSec,
    uri: coverUri,
    filterId: 'none',
  };

  return {
    ...project,
    kind: 'audio',
    tracks: [
      { id: 'album-video', type: 'video', name: 'Borító', clips: [coverClip] },
      { id: 'album-music', type: 'music', name: 'Album', clips: audioClips },
    ],
    rendered: undefined,
  };
}
