import type { Asset, ImageDoc, PhotoLayer, Project } from '@/types/project';

/**
 * 🖼️ A kép-dokumentumok médiahivatkozásai (expo-mentes mag). A rétegek fájljai
 * (galéria-fotó, ecset-PNG, LUT, PSD/PDF-kép) a `project.assets`-be kerülnek — így a
 * média-backup, a hiányzó-fájl felismerés és a relink ugyanúgy látja őket, mint a
 * videó-klipekét. Egyetlen helyen, a command-reducerből hívva, hogy MINDEN beszúrási
 * út (galéria, ecset, varázspálca, PSD/PDF, AI) lefedett legyen.
 */

export interface ImageMediaRef {
  uri: string;
  role: 'photo' | 'lut';
  name: string;
}

const fileName = (uri: string) => uri.split('/').pop()?.split('?')[0] || uri;

/** http(s)/data URI-t nem kell backupolni — az nem eszközhöz kötött fájl */
const isLocal = (uri: string | undefined): uri is string => !!uri && !/^(https?|data):/i.test(uri);

/** Egy dokumentum összes helyi médiahivatkozása (ismétlés nélkül). */
export function imageDocMediaRefs(doc: ImageDoc): ImageMediaRef[] {
  const seen = new Map<string, ImageMediaRef>();
  for (const layer of doc.layers) {
    if (layer.kind !== 'photo') {
      continue;
    }
    if (isLocal(layer.uri) && !seen.has(layer.uri)) {
      seen.set(layer.uri, { uri: layer.uri, role: 'photo', name: layer.name ?? fileName(layer.uri) });
    }
    if (isLocal(layer.lut) && !seen.has(layer.lut)) {
      seen.set(layer.lut, { uri: layer.lut, role: 'lut', name: layer.lutName ?? fileName(layer.lut) });
    }
    const maskImage = layer.mask?.image;
    if (isLocal(maskImage) && !seen.has(maskImage)) {
      seen.set(maskImage, { uri: maskImage, role: 'photo', name: fileName(maskImage) });
    }
  }
  return [...seen.values()];
}

/** A projekt minden kép-dokumentumának hivatkozása (ismétlés nélkül). */
export function projectImageMediaRefs(project: Project): ImageMediaRef[] {
  const seen = new Map<string, ImageMediaRef>();
  for (const doc of project.imageDocs ?? []) {
    for (const ref of imageDocMediaRefs(doc)) {
      if (!seen.has(ref.uri)) {
        seen.set(ref.uri, ref);
      }
    }
  }
  return [...seen.values()];
}

/** Determinisztikus azonosító (a reducer tiszta marad: nincs véletlen). */
function assetIdFor(uri: string): string {
  let h = 5381;
  for (let i = 0; i < uri.length; i++) {
    h = ((h * 33) ^ uri.charCodeAt(i)) >>> 0;
  }
  return `imgasset_${h.toString(36)}`;
}

/** A doc még nem regisztrált médiáinak felvétele a `project.assets`-be. */
export function withImageDocAssets(project: Project, doc: ImageDoc): Project {
  const known = new Set(project.assets.map((a) => a.uri));
  const added: Asset[] = [];
  for (const ref of imageDocMediaRefs(doc)) {
    if (known.has(ref.uri)) {
      continue;
    }
    known.add(ref.uri);
    added.push({
      id: assetIdFor(ref.uri),
      kind: 'image',
      uri: ref.uri,
      provider: 'local',
      name: ref.name,
      ...(ref.role === 'lut' ? { role: 'lut' as const } : {}),
    });
  }
  return added.length > 0 ? { ...project, assets: [...project.assets, ...added] } : project;
}

/** Van-e a dokumentumokban hivatkozás az adott uri-ra? */
export function imageDocsReference(project: Project, uri: string): boolean {
  return projectImageMediaRefs(project).some((r) => r.uri === uri);
}

/** Uri-csere a rétegekben (relink). Változás nélkül ugyanazt a tömböt adja vissza. */
export function relinkImageDocs(docs: ImageDoc[] | undefined, oldUri: string, newUri: string): ImageDoc[] | undefined {
  if (!docs) {
    return docs;
  }
  let changed = false;
  const next = docs.map((doc) => {
    let docChanged = false;
    const layers = doc.layers.map((layer) => {
      if (layer.kind !== 'photo' || (layer.uri !== oldUri && layer.lut !== oldUri && layer.mask?.image !== oldUri)) {
        return layer;
      }
      docChanged = true;
      const patched: PhotoLayer = { ...layer };
      if (layer.uri === oldUri) {
        patched.uri = newUri;
      }
      if (layer.lut === oldUri) {
        patched.lut = newUri;
      }
      if (layer.mask?.image === oldUri) {
        patched.mask = { ...layer.mask, image: newUri };
      }
      return patched;
    });
    if (!docChanged) {
      return doc;
    }
    changed = true;
    return { ...doc, layers };
  });
  return changed ? next : docs;
}
