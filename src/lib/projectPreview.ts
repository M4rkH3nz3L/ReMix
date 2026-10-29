import type { Project } from '@/types/project';

/**
 * 🖼️ A projekt ELŐNÉZETI képének forrása (pure, expo-mentes → tesztelhető).
 *
 * Sorrend: 1) a felhasználó által választott borítókép (`coverAssetId` — hangnál az
 * album-borító); 2) a fajta saját képe: 3D → a szken poszter-képe, kép → a renderelt lap
 * (vagy az első fotó-réteg), hang → az album borító-dokumentuma, videó/élő → az első
 * videóklip egy kockája (vagy az első képklip). `null` → nincs kép, a hívó ikont mutat.
 */
export type PreviewSource =
  | { type: 'image'; uri: string }
  /** a videó egy kockája — a hívó bélyegképet generál belőle (`getFilmstrip`) */
  | { type: 'videoFrame'; uri: string; time: number }
  | null;

/** egy kép-dokumentum képe: a renderelt változat, különben az első fotó-réteg */
function imageDocPicture(project: Project, docId?: string): string | null {
  const docs = project.imageDocs ?? [];
  const doc = docId ? docs.find((d) => d.id === docId) : docs[0];
  if (!doc) {
    return null;
  }
  if (doc.renderedUri) {
    return doc.renderedUri;
  }
  const photo = doc.layers.find((l) => l.kind === 'photo');
  return photo && photo.kind === 'photo' && photo.uri ? photo.uri : null;
}

export function projectPreviewSource(project: Project): PreviewSource {
  // 1) a választott borító (minden fajtánál elsőbbséget kap)
  if (project.coverAssetId) {
    const cover = project.assets.find((a) => a.id === project.coverAssetId);
    if (cover?.uri) {
      return { type: 'image', uri: cover.uri };
    }
  }
  const kind = project.kind ?? 'video';
  if (kind === 'model3d') {
    const poster = project.model3d?.poster;
    return poster ? { type: 'image', uri: poster } : null;
  }
  if (kind === 'image') {
    const pic = imageDocPicture(project);
    return pic ? { type: 'image', uri: pic } : null;
  }
  if (kind === 'audio') {
    const coverDocId = project.album?.coverDocId;
    const pic = coverDocId ? imageDocPicture(project, coverDocId) : null;
    return pic ? { type: 'image', uri: pic } : null;
  }
  // videó / élő / egyéb: az első videóklip kockája, különben az első képklip
  const videoTrack = project.tracks.find((t) => t.type === 'video');
  const clip = videoTrack?.clips.find((c) => c.kind === 'video');
  if (clip && clip.kind === 'video') {
    return { type: 'videoFrame', uri: clip.uri, time: clip.trimIn + 0.5 };
  }
  for (const track of project.tracks) {
    const img = track.clips.find((c) => c.kind === 'image');
    if (img && img.kind === 'image' && img.uri) {
      return { type: 'image', uri: img.uri };
    }
  }
  return null;
}
