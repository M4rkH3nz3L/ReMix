import { withImageDocAssets } from '@/lib/imageDocMedia';
import type { Project } from '@/types/project';

import type { CommandOf } from './types';

/** 🎨 Dokumentum-reducerek: kép-lapok, hangszer-minták, live, 3D és album beírása. */

export function reduceUpsertImageDoc(project: Project, cmd: CommandOf<'UPSERT_IMAGE_DOC'>): Project | null {
  const docs = project.imageDocs ?? [];
  const index = docs.findIndex((d) => d.id === cmd.doc.id);
  if (index >= 0 && JSON.stringify(docs[index]) === JSON.stringify(cmd.doc)) {
    return null; // semmi nem változott — ne szemetelje a history-t
  }
  const next = index >= 0
    ? docs.map((d) => (d.id === cmd.doc.id ? cmd.doc : d))
    : [...docs, cmd.doc];
  // 🗄️ I2: a rétegek fájljai assetként regisztrálódnak (backup / relink / hiányzó-jelzés)
  return withImageDocAssets({ ...project, imageDocs: next }, cmd.doc);
}

export function reduceUpsertInstrumentDoc(project: Project, cmd: CommandOf<'UPSERT_INSTRUMENT_DOC'>): Project | null {
  const docs = project.instrumentDocs ?? [];
  const index = docs.findIndex((d) => d.id === cmd.doc.id);
  if (index >= 0 && JSON.stringify(docs[index]) === JSON.stringify(cmd.doc)) {
    return null;
  }
  return {
    ...project,
    instrumentDocs: index >= 0 ? docs.map((d) => (d.id === cmd.doc.id ? cmd.doc : d)) : [...docs, cmd.doc],
  };
}

export function reduceRemoveImageDoc(project: Project, cmd: CommandOf<'REMOVE_IMAGE_DOC'>): Project | null {
  const docs = project.imageDocs ?? [];
  const next = docs.filter((d) => d.id !== cmd.docId);
  if (next.length === docs.length) {
    return null;
  }
  const removed = { ...project, imageDocs: next.length > 0 ? next : undefined };
  // 🖼️ CORE K5: a törölt thumbnail-lapra nem maradhat hivatkozás
  if (project.thumbnailDocId === cmd.docId) {
    const { thumbnailDocId: _gone, ...rest } = removed;
    return rest;
  }
  return removed;
}

export function reduceReorderImageDocs(project: Project, cmd: CommandOf<'REORDER_IMAGE_DOCS'>): Project | null {
  const docs = project.imageDocs ?? [];
  if (docs.length < 2) {
    return null;
  }
  const rank = new Map(cmd.order.map((id, i) => [id, i]));
  // stabil rendezés: az order-ben szereplők elöl (sorrendben), a többi a végén az eredeti sorrendjében
  const next = docs
    .map((d, i) => ({ d, i, r: rank.has(d.id) ? (rank.get(d.id) as number) : cmd.order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.d);
  if (next.every((d, i) => d.id === docs[i].id)) {
    return null; // nem változott a sorrend
  }
  return { ...project, imageDocs: next };
}

export function reduceSetLiveDoc(project: Project, cmd: CommandOf<'SET_LIVE_DOC'>): Project | null {
  if (JSON.stringify(project.live ?? null) === JSON.stringify(cmd.doc)) {
    return null; // semmi nem változott — ne szemetelje a history-t
  }
  return { ...project, live: cmd.doc };
}

export function reduceSetModel3dDoc(project: Project, cmd: CommandOf<'SET_MODEL3D_DOC'>): Project | null {
  if (JSON.stringify(project.model3d ?? null) === JSON.stringify(cmd.doc)) {
    return null; // semmi nem változott — ne szemetelje a history-t
  }
  return { ...project, model3d: cmd.doc };
}

export function reduceApplyAlbum(project: Project, cmd: CommandOf<'APPLY_ALBUM'>): Project | null {
  const prev = project.album;
  // 1) a JELENLEGI idővonalat elmentjük az ELŐZŐ aktív számba (ha az létezik az új listában)
  let songs = cmd.album.songs;
  if (prev && songs.some((s) => s.id === prev.activeSongId)) {
    songs = songs.map((s) =>
      s.id === prev.activeSongId ? { ...s, tracks: project.tracks, assets: project.assets } : s
    );
  }
  const nextAlbum = { ...cmd.album, songs };
  // 2) az ÚJ aktív szám sávjait töltjük a project.tracks-ba (ha van ilyen szám)
  const active = songs.find((s) => s.id === nextAlbum.activeSongId);
  const tracks = active ? active.tracks : project.tracks;
  const assets = active ? active.assets : project.assets;
  if (
    JSON.stringify(project.album ?? null) === JSON.stringify(nextAlbum) &&
    project.tracks === tracks
  ) {
    return null; // semmi nem változott
  }
  return { ...project, tracks, assets, album: nextAlbum };
}
