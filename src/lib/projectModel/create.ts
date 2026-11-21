import { t as tr } from 'i18next';

import { makeId } from '@/lib/id';
import { masterPreset } from '@/lib/audioMaster';
import { createImageDoc, type ImageDocBackground } from '@/lib/imageDoc';
import { createLiveDoc } from '@/lib/liveDoc';
import { createModel3DDoc } from '@/lib/model3dDoc';
import type { MeshFormat } from '@/types/model3d';
import { projectKindMeta } from '@/lib/projectKinds';
import { CANONICAL_TRACKS } from '@/lib/projectModel/tracks';
import { CURRENT_SCHEMA_VERSION } from '@/lib/projectModel/schema';
import type {
  AspectRatio,
  AudioMasterTarget,
  Project,
  ProjectKind,
  ProjectSeo,
} from '@/types/project';

/**
 * 🎛️ Fajta-specifikus létrehozási beállítások (az „Új projekt” űrlapból):
 * kép → vászonméret + háttér; hang → master-cél (az alap hangosság/plafon preset).
 */
export interface CreateProjectConfig {
  image?: {
    width?: number;
    height?: number;
    background?: ImageDocBackground;
    format?: 'raster' | 'vector';
  };
  audioMasterTarget?: AudioMasterTarget;
  /** 🧊 3D: a modell tárolási formátuma (USDZ / GLB / OBJ / PLY) */
  model3dStorageFormat?: MeshFormat;
}

/** A projekt fajtája, alapértelmezéssel (a régi, kind nélküli projektek videók). */
export function projectKind(project: { kind?: ProjectKind }): ProjectKind {
  return project.kind ?? 'video';
}

/**
 * A projekt-fajtához tartozó szerkesztő-útvonal — a főképernyő ebből routol a
 * megfelelő stúdióba (a videó a teljes `/editor`, a kép/hang a saját stúdiója).
 */
export function studioRoute(kind: ProjectKind | undefined, id: string): string {
  const meta = projectKindMeta(kind);
  // a KÉSZ stúdiók a saját útvonalukra; a stúdió-nélküli (CreativeDocument-
  // bővítés) fajták a videó-editorra esnek vissza, amíg a stúdiójuk el nem készül
  return meta.editable ? meta.route(id) : `/editor/${id}`;
}

export function createEmptyProject(
  name: string,
  aspectRatio: AspectRatio,
  seo?: ProjectSeo,
  kind: ProjectKind = 'video',
  config?: CreateProjectConfig
): Project {
  const now = new Date().toISOString();
  return {
    id: makeId('prj'),
    name,
    kind,
    aspectRatio,
    fps: 30,
    // a SEO-meta a létrehozáskor kötelező (Új projekt űrlap); demo/import útján
    // hiányozhat — ezért opcionális a mezőn, és csak akkor kerül be, ha van
    ...(seo ? { seo } : {}),
    // MINDEN fajta megkapja a kanonikus sávokat: a kép/hang kimenete a
    // videó-editorban is használható, és így a közös `trackOf`/lib-függvények
    // sosem dobnak hiányzó-sáv kivételt (a stúdiók a szerkesztő-UI-t szűkítik).
    tracks: CANONICAL_TRACKS.map((t) => ({
      id: makeId('trk'),
      type: t.type,
      name: tr(t.name),
      clips: [],
    })),
    assets: [],
    // 🎨 a képstúdió a réteg-fát szerkeszti → egy üres kép-dokumentum előre,
    // hogy a stúdiónak legyen mivel indulnia (a kirasterizált PNG lesz a média).
    // A vászonméret + háttér a létrehozó-űrlapból (config.image).
    ...(kind === 'image' || kind === 'design'
      ? { imageDocs: [createImageDoc(name, aspectRatio, () => makeId('lyr'), config?.image)] }
      : {}),
    // 🎚️ a hang-projekt alap master-célja (az első beállítás): a loudness/plafon
    // preset a cél szerint (podcast/zene/social/videó) — a MasterSheet később módosítja.
    ...((kind === 'audio' || kind === 'music') && config?.audioMasterTarget
      ? { audioMaster: masterPreset(config.audioMasterTarget) }
      : {}),
    // 🎥 a live-stúdió a scene/forrás-grafet szerkeszti → egy kiinduló live-doc
    // (Main jelenet + kamera + ReMix-cél); a Live-hub a „Go live"-nál ezt hozza.
    ...(kind === 'live' ? { live: createLiveDoc(name, () => makeId('live')) } : {}),
    // 🧊 a 3D-stúdió üres dokumentummal indul; a szken (3D-1) tölti fel hálóval
    // (a létrehozó-űrlapon választott tárolási formátummal)
    ...(kind === 'model3d' ? { model3d: createModel3DDoc(undefined, config?.model3dStorageFormat) } : {}),
    createdAt: now,
    updatedAt: now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
