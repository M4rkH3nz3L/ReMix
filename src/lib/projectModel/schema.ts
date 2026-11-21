import { t as tr } from 'i18next';

import { ensureClipAssets } from '@/lib/assetResolve';
import { makeId } from '@/lib/id';
import { CANONICAL_TRACKS } from '@/lib/projectModel/tracks';
import type { Asset, Clip, Project, TrackType } from '@/types/project';

/**
 * Minden kanonikus sáv MEGLÉTÉNEK biztosítása — a hiányzókat üresen pótolja (a
 * meglévő sávok és klipjeik érintetlenek). Így egy régi mentett projekt, amiben
 * még nincs `pip`/`adjust` sáv, nem dönti le a szerkesztőt (`trackOf` kivétel).
 */
function ensureCanonicalTracks(project: Project): Project {
  const have = new Set(project.tracks.map((t) => t.type));
  const missing = CANONICAL_TRACKS.filter((t) => !have.has(t.type)).map((t) => ({
    id: makeId('trk'),
    type: t.type,
    name: tr(t.name),
    clips: [] as Clip[],
  }));
  return { ...project, tracks: [...project.tracks, ...missing], schemaVersion: 5 };
}

/** Séma-migráció betöltéskor — idempotens, lépcsőzetes. */
/**
 * 📐 Az app által ismert legújabb projekt-séma. v7 (2026-11-12): a v6 után bevezetett, mind
 * opcionális hang-mezők (take-ek, effekt-sorrend, master-dinamika, sáv-zár, hangszer-minták) —
 * a lépés csak a verziót lépteti. v8 (2026-11-14): `Asset.source` (linked asset: a videó a
 * hang-projekt mixdownjára hivatkozik, verzióval) és a sampler hangszer-minta — mind opcionális,
 * a lépés csak a verziót lépteti. v9 (2026-11-15): a kép-hivatkozás (`Asset.source.output: 'still'`,
 * CORE K2) és a szerkeszthető thumbnail (`thumbnailDocId`, `RenderedVersion.posterKey`, CORE K5) —
 * opcionálisak, csak a verzió lép. v10 (2026-11-15): a projekt saját betűtípusai (`fonts`, IMAGE-PROD
 * S10) — opcionális, csak a verzió lép. Ennél ÚJABB projekt (egy későbbi app-verzió mentette) csak
 * olvasható: a parancs-busz, a helyi mentés és a felhő-feltöltés sem írja (különben a régi app
 * csendben elhagyná, amit nem ismer — pl. a v7-es app a hivatkozást).
 */
export const CURRENT_SCHEMA_VERSION = 10;

/** egy újabb app-verzió projektje-e (csak olvasható) */
export function isNewerSchema(project: Pick<Project, 'schemaVersion'> | null | undefined): boolean {
  return !!project && Number(project.schemaVersion) > CURRENT_SCHEMA_VERSION;
}

export function migrateProject(project: Project): Project {
  let next = project;
  if (next.schemaVersion < 2 || !Array.isArray(next.assets)) {
    next = migrateToV2(next);
  }
  if (next.schemaVersion < 3) {
    next = migrateToV3(next);
  }
  if (next.schemaVersion < 4) {
    // v3 → v4: a kulcskocka-mezők opcionálisak, csak a verzió lép
    next = { ...next, schemaVersion: 4 };
  }
  if (next.schemaVersion < 5) {
    // v4 → v5: a később bevezetett sávok (pip, adjust) pótlása a régi projektekben
    next = ensureCanonicalTracks(next);
  }
  if (next.schemaVersion < 6) {
    // v5 → v6: projekt-fajta (kind) — a régi, kind nélküli projektek videók
    next = { ...next, kind: next.kind ?? 'video', schemaVersion: 6 };
  }
  if (next.schemaVersion < 7) {
    // v6 → v7: az új hang-mezők opcionálisak, csak a verzió lép
    next = { ...next, schemaVersion: 7 };
  }
  if (next.schemaVersion < 8) {
    // v7 → v8: linked asset (`Asset.source`) és sampler-minta — opcionálisak, csak a verzió lép
    next = { ...next, schemaVersion: 8 };
  }
  if (next.schemaVersion < 9) {
    // v8 → v9: kép-hivatkozás (still) és szerkeszthető thumbnail — opcionálisak, csak a verzió lép
    next = { ...next, schemaVersion: 9 };
  }
  if (next.schemaVersion < 10) {
    // v9 → v10: a projekt saját betűtípusai — opcionális, csak a verzió lép
    next = { ...next, schemaVersion: 10 };
  }
  // 🔗 verzió-független backfill (ADR-012): a séma-migráció utáni úton (preset/AI/
  // hang-leválasztás) assetId NÉLKÜL hozzáadott media-klipek is kapjanak asset-linket.
  // Determinisztikus id (assetIdForUri) → idempotens + round-trip- és collab-stabil.
  next = ensureClipAssets(next);
  return next;
}

/** v1 → v2: asset-registry a médiaklipek uri-jaiból, a klipek assetId-t kapnak. */
function migrateToV2(project: Project): Project {
  const assets: Asset[] = [];
  const byUri = new Map<string, Asset>();

  const assetFor = (clip: Clip): Asset | null => {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'audio') {
      return null;
    }
    const existing = byUri.get(clip.uri);
    if (existing) {
      return existing;
    }
    const asset: Asset = {
      id: makeId('ast'),
      kind: clip.kind,
      uri: clip.uri,
      provider: 'local',
      name: 'label' in clip ? clip.label : undefined,
      duration: clip.kind === 'video' ? clip.sourceDuration : undefined,
    };
    byUri.set(clip.uri, asset);
    assets.push(asset);
    return asset;
  };

  const tracks = project.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const asset = assetFor(clip);
      return asset ? ({ ...clip, assetId: asset.id } as Clip) : clip;
    }),
  }));

  return { ...project, tracks, assets, schemaVersion: 2 };
}

/**
 * v2 → v3: sáv-bővítés. A régi egyetlen hang-sáv klipjei forrás szerint a
 * Zene / Voiceover sávra kerülnek; létrejön a Felirat, Matrica és SFX sáv.
 */
function migrateToV3(project: Project): Project {
  const oldTracks = project.tracks as { type: string; clips: Clip[]; id: string; name: string }[];
  const byType = new Map(oldTracks.map((t) => [t.type, t]));
  const legacyAudio = byType.get('audio')?.clips ?? [];

  const clipsFor = (type: TrackType): Clip[] => {
    switch (type) {
      case 'music':
        return legacyAudio.filter((c) => c.kind === 'audio' && c.source !== 'voiceover');
      case 'voiceover':
        return legacyAudio.filter((c) => c.kind === 'audio' && c.source === 'voiceover');
      default:
        return byType.get(type)?.clips ?? [];
    }
  };

  return {
    ...project,
    tracks: CANONICAL_TRACKS.map((t) => ({
      id: byType.get(t.type)?.id ?? makeId('trk'),
      type: t.type,
      name: tr(t.name),
      clips: clipsFor(t.type),
    })),
    schemaVersion: 3,
  };
}
