import { makeId } from '@/lib/id';
import { pickAudio, pickImage, pickVideo } from '@/lib/media';
import type { Asset, Project, ProjectKind } from '@/types/project';

/**
 * 🗂️ A projekt FORRÁS-MAPPÁJA (source bin) — a `project.assets` regiszter köré
 * épülő, minden stúdióban AZONOSAN működő média-könyvtár. Ide importálhatók a
 * támogatott fájlok (már a létrehozáskor is), és innen használja fel a szerkesztő.
 *
 * Egy forrás = egy `Asset` (video/image/audio). Ez a modul TISZTA logikát ad
 * (melyik fajta mit fogad, picker→Asset leképezés, használatban-van? véd), a
 * tényleges betöltést a `media.ts` pickerek intézik.
 */

export type SourceKind = 'video' | 'image' | 'audio';

const KIND_ORDER: SourceKind[] = ['video', 'image', 'audio'];

/** melyik médiatípusokat fogadja egy projekt-fajta forrás-mappája (logikus halmaz). */
export function supportedSourceKinds(kind: ProjectKind | undefined): SourceKind[] {
  switch (kind) {
    case 'image':
      return ['image'];
    case 'audio':
      return ['audio'];
    case 'video':
    default:
      // a videó-idővonal mindhárom médiát használja (kép/hang/videó)
      return KIND_ORDER;
  }
}

/** egy picker-eredményből `Asset` a forrás-mappába (persistált helyi másolat). */
export function assetFromPicked(
  kind: SourceKind,
  picked: { uri: string; name?: string; duration?: number; width?: number; height?: number }
): Asset {
  return {
    id: makeId('ast'),
    kind,
    uri: picked.uri,
    provider: 'local',
    name: picked.name ?? fileName(picked.uri),
    ...(picked.duration ? { duration: picked.duration } : {}),
    ...(picked.width ? { width: picked.width } : {}),
    ...(picked.height ? { height: picked.height } : {}),
  };
}

/** egy forrás kiválasztása a támogatott pickerrel → `Asset`, vagy `null` (mégse). */
export async function pickSourceAsset(kind: SourceKind): Promise<Asset | null> {
  if (kind === 'video') {
    const v = await pickVideo();
    return v ? assetFromPicked('video', v) : null;
  }
  if (kind === 'audio') {
    const a = await pickAudio();
    return a ? assetFromPicked('audio', a) : null;
  }
  const img = await pickImage();
  return img ? assetFromPicked('image', { uri: img.uri }) : null;
}

/**
 * Egy forrás HASZNÁLATBAN van-e (klip vagy kép-réteg hivatkozza az uri-ját).
 * A forrás-mappából csak a NEM használt elem távolítható el biztonságosan.
 */
export function assetInUse(project: Project, asset: Asset): boolean {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if ((clip as { uri?: string }).uri === asset.uri) {
        return true;
      }
    }
  }
  for (const doc of project.imageDocs ?? []) {
    for (const layer of doc.layers) {
      if (layer.kind === 'photo' && layer.uri === asset.uri) {
        return true;
      }
      if (layer.kind === 'shape' && layer.imageUri === asset.uri) {
        return true;
      }
    }
  }
  return false;
}

/** forrás-fajtánkénti darabszám (a forrás-mappa szűrő-chipjeihez). */
export function countSourceKinds(assets: Asset[]): Record<SourceKind, number> {
  return {
    video: assets.filter((a) => a.kind === 'video').length,
    image: assets.filter((a) => a.kind === 'image').length,
    audio: assets.filter((a) => a.kind === 'audio').length,
  };
}

/** rövid, determinisztikus összegző a forrás-mappáról (pl. „2 videó · 3 kép"). */
export function sourceSummary(assets: Asset[], label: (kind: SourceKind) => string): string {
  const counts = KIND_ORDER.map((k) => ({ k, n: assets.filter((a) => a.kind === k).length })).filter(
    (c) => c.n > 0
  );
  return counts.map((c) => `${c.n} ${label(c.k)}`).join(' · ');
}

function fileName(uri: string): string {
  return uri.split('/').pop()?.split('?')[0] || 'media';
}
