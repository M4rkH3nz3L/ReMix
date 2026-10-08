import type { Asset, Clip, Project } from '@/types/project';

/**
 * 🔗 Asset-architektúra: `uri → assetId` (ADR-012).
 *
 * Az ASSET a média forrás-igazsága; a klipek `assetId`-vel hivatkoznak rá, és a
 * lejátszandó URI-t az asseten át oldják fel (`resolveClipUri`). Így egy asset
 * relinkelése MINDEN rá hivatkozó klipet frissít — ez a collab/undo/cloud-sync
 * alapja. Átmenetileg a klipek a saját `uri`-jukat is hordozzák (feloldott
 * cache a backward-compat miatt); a fogyasztók fokozatosan állnak a resolverre.
 *
 * SZÁNDÉKOSAN pure + expo-mentes (önmagában tesztelhető, lásd AGENTS.md).
 */

/** A média-klipek, amik assethez köthetők (uri-t hordoznak). */
function isMediaClip(clip: Clip): clip is Clip & { uri: string; kind: 'video' | 'image' | 'audio' } {
  return (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') && 'uri' in clip;
}

function clipUriOf(clip: Clip): string | undefined {
  return 'uri' in clip ? (clip as { uri?: string }).uri : undefined;
}

/**
 * Determinisztikus, tartalom-címzett asset-id a backfillhez (ADR-012): a SAME uri
 * → SAME id minden kliensen és minden betöltésnél. Enélkül a `makeId` (véletlen)
 * eltörné a bitre-azonos mentés→újratöltés round-tripet és collab-divergenciát
 * okozna. Két 32-bites FNV-1a hash (~64 bit) a névtér-ütközés ellen.
 */
export function assetIdForUri(uri: string): string {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ uri.length) >>> 0;
  for (let i = 0; i < uri.length; i++) {
    const c = uri.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + 0x9e), 0x01000193);
  }
  return `ast_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/**
 * A klip forrás-assetje: elsődlegesen `assetId`-n át, visszaesés uri-egyezésre
 * (még nem ingestelt projekt / nem-media klip esetén `null`).
 */
export function assetForClip(project: Project, clip: Clip): Asset | null {
  const assetId = (clip as { assetId?: string }).assetId;
  if (assetId) {
    const byId = project.assets.find((a) => a.id === assetId);
    if (byId) {
      return byId;
    }
  }
  const uri = clipUriOf(clip);
  if (uri) {
    return project.assets.find((a) => a.uri === uri) ?? null;
  }
  return null;
}

/**
 * A klip lejátszandó URI-ja: az asset a forrás-igazság (assetId-n át), így az
 * asset relinkelése minden rá hivatkozó klipet frissít. Visszaesés a klip saját
 * uri-jára (assetId nélküli klip / még nem ingestelt projekt).
 */
export function resolveClipUri(project: Project, clip: Clip): string | undefined {
  const asset = assetForClip(project, clip);
  return asset ? asset.uri : clipUriOf(clip);
}

/**
 * Asset-centrikus relink: a megadott asset URI-ját cseréli, és a rá hivatkozó
 * klipek uri-cache-ét szinkronban tartja (amíg a fogyasztók a `resolveClipUri`-ra
 * állnak). Egy hívás → minden érintett klip. A kötés `assetId`-egyezés, vagy
 * (még nem linkelt klipnél) a régi uri-egyezés. Nincs változás → az eredeti projekt.
 */
export function relinkAsset(project: Project, assetId: string, newUri: string): Project {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset || asset.uri === newUri) {
    return project;
  }
  const oldUri = asset.uri;
  return {
    ...project,
    assets: project.assets.map((a) => (a.id === assetId ? { ...a, uri: newUri } : a)),
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        const clipAssetId = (clip as { assetId?: string }).assetId;
        const linked = clipAssetId ? clipAssetId === assetId : clipUriOf(clip) === oldUri;
        if (linked && 'uri' in clip && (clip as { uri?: string }).uri !== newUri) {
          return { ...clip, uri: newUri } as Clip;
        }
        return clip;
      }),
    })),
  };
}

/**
 * Betöltéskori backfill: minden media-klip, aminek nincs `assetId`-je, kapjon
 * assetet (uri szerint find-or-create) + linket. **Idempotens** — ha már minden
 * media-klip linkelt, az EREDETI projekt-referenciát adja vissza (nincs fölös
 * re-render / churn). A backfill `assetIdForUri`-t használ (determinisztikus,
 * tartalom-címzett), így kétszer betöltve ugyanazt az id-t adja (round-trip) és
 * kliensek közt sem divergál.
 */
export function ensureClipAssets(project: Project): Project {
  const assets = [...project.assets];
  const byUri = new Map<string, Asset>();
  for (const a of assets) {
    if (!byUri.has(a.uri)) {
      byUri.set(a.uri, a);
    }
  }
  let changed = false;

  const tracks = project.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (!isMediaClip(clip) || (clip as { assetId?: string }).assetId) {
        return clip;
      }
      let asset = byUri.get(clip.uri);
      if (!asset) {
        asset = {
          id: assetIdForUri(clip.uri),
          kind: clip.kind,
          uri: clip.uri,
          provider: 'local',
          name: 'label' in clip ? (clip as { label?: string }).label : undefined,
          duration:
            clip.kind === 'video' ? (clip as { sourceDuration?: number }).sourceDuration : undefined,
        };
        byUri.set(clip.uri, asset);
        assets.push(asset);
      }
      trackChanged = true;
      changed = true;
      return { ...clip, assetId: asset.id } as Clip;
    });
    return trackChanged ? { ...track, clips } : track;
  });

  return changed ? { ...project, assets, tracks } : project;
}
