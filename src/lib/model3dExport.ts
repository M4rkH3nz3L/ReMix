/**
 * 📦 3D-export és -tárolás döntései (3D-Studio.md §3, §5, §9) — pure.
 *
 *  • formátum-képességmátrix (GLB · FBX · OBJ · USDZ · USD · PLY · STL) — mind a
 *    KÉSZÜLÉKEN készül (remix-3d natív írók), ingyenes;
 *  • export-beállítások: geometria-minőség (eredeti / magas / optimalizált), egység
 *    (m / cm / mm — EGYSZER skálázunk, a natív író nem), textúrák és színek;
 *  • a tárolási formátum (a projekt-létrehozáskor választott) a szken fajtája szerint;
 *  • felhasználás szerinti cél-háromszögszám, figyelmeztetések, biztonságos fájlnév.
 */
import { boundsRadius } from '@/lib/model3d';
import { modelRotation } from '@/lib/model3dLook';
import type { Bounds3, MeshFormat, Model3DDoc, Model3DMesh } from '@/types/model3d';

/** a kiviteli formátumok (a tárolhatóaknál bővebb: FBX és USD csak kivitel) */
export type ExportFormat = 'glb' | 'fbx' | 'obj' | 'usdz' | 'usd' | 'ply' | 'stl';
export type ExportQuality = 'original' | 'high' | 'optimized';
export type ExportUnit = 'm' | 'cm' | 'mm';
/** hová kerül a kész fájl: a projekt mappája a telefonon / ReMix Storage / megosztás-lap */
export type ExportDestination = 'device' | 'remix' | 'share';

export interface FormatSpec {
  format: ExportFormat;
  /** a fájl kiterjesztése (az OBJ textúrával .zip-be kerül — a natív író dönt) */
  ext: string;
  /** a készüléken készül → ingyenes */
  local: boolean;
  /** textúrát visz (GLB/FBX beágyazva, OBJ .mtl + képek, USDZ csomagban) */
  textures: boolean;
  /** textúra helyett csúcs-színt visz (PLY) */
  colors: boolean;
  /** pontfelhőt is ír (GLB POINTS / PLY) */
  pointCloud: boolean;
  /** állítható egység (a glTF és a USD szabvány szerint MÉTER — ott nincs választás) */
  units: boolean;
  defaultUnit: ExportUnit;
  /** a natív képesség-flag, amin múlik (pl. USD → `usdExport`) */
  needsCapability?: 'usdExport';
  /** tipikus felhasználás (i18n-kulcs) */
  useKey: string;
}

/** a megjelenítési sorrend is: GLB az alap (univerzális, egy fájl) */
export const EXPORT_FORMATS: Record<ExportFormat, FormatSpec> = {
  glb: { format: 'glb', ext: 'glb', local: true, textures: true, colors: true, pointCloud: true, units: false, defaultUnit: 'm', useKey: 'model3d.export.useWeb' },
  fbx: { format: 'fbx', ext: 'fbx', local: true, textures: true, colors: true, pointCloud: false, units: true, defaultUnit: 'm', useKey: 'model3d.export.useFbx' },
  obj: { format: 'obj', ext: 'obj', local: true, textures: true, colors: true, pointCloud: false, units: true, defaultUnit: 'm', useKey: 'model3d.export.useEditing' },
  usdz: { format: 'usdz', ext: 'usdz', local: true, textures: true, colors: true, pointCloud: false, units: false, defaultUnit: 'm', useKey: 'model3d.export.useAr' },
  usd: { format: 'usd', ext: 'usd', local: true, textures: false, colors: true, pointCloud: false, units: false, defaultUnit: 'm', needsCapability: 'usdExport', useKey: 'model3d.export.useUsd' },
  ply: { format: 'ply', ext: 'ply', local: true, textures: false, colors: true, pointCloud: true, units: true, defaultUnit: 'm', useKey: 'model3d.export.usePointCloud' },
  stl: { format: 'stl', ext: 'stl', local: true, textures: false, colors: false, pointCloud: false, units: true, defaultUnit: 'mm', useKey: 'model3d.export.usePrint' },
};

export const EXPORT_ORDER: readonly ExportFormat[] = ['glb', 'fbx', 'obj', 'usdz', 'usd', 'ply', 'stl'];
export const EXPORT_QUALITIES: readonly ExportQuality[] = ['original', 'high', 'optimized'];
export const EXPORT_UNITS: readonly ExportUnit[] = ['m', 'cm', 'mm'];

/** méter → egység szorzó */
export const UNIT_SCALE: Record<ExportUnit, number> = { m: 1, cm: 100, mm: 1000 };

/** a modellhez kínálható formátumok (pontfelhő: csak GLB/PLY; képesség-flagek szerint) */
export function availableExportFormats(
  mesh: Pick<Model3DMesh, 'points'>,
  caps: { usdExport?: boolean } = {}
): ExportFormat[] {
  return EXPORT_ORDER.filter((f) => {
    const spec = EXPORT_FORMATS[f];
    if (mesh.points && !spec.pointCloud) return false;
    if (spec.needsCapability && !caps[spec.needsCapability]) return false;
    return true;
  });
}

export interface ExportSettings {
  format: ExportFormat;
  quality: ExportQuality;
  unit: ExportUnit;
  /** textúrák és színek */
  textures: boolean;
}

export function defaultExportSettings(format: ExportFormat = 'glb'): ExportSettings {
  return { format, quality: 'original', unit: EXPORT_FORMATS[format].defaultUnit, textures: true };
}

/** formátum-váltáskor az egység a formátum alapjára áll (STL → mm), a többi marad */
export function withFormat(s: ExportSettings, format: ExportFormat): ExportSettings {
  return { ...s, format, unit: EXPORT_FORMATS[format].defaultUnit };
}

/**
 * A minőség → egyszerűsítési rács (méter) + textúra-plafon (px). Az „eredeti" a szken
 * maga; a „magas" finoman ritkít (a részletek maradnak), az „optimalizált" web/AR-ra
 * szab (kisebb háló + 2K textúra). A rács az átlóhoz arányos → bármilyen méretű tárgyra jó.
 */
export function qualityParams(bounds: Bounds3, quality: ExportQuality): { cell: number; maxTexture: number } {
  const d = boundsRadius(bounds) * 2;
  switch (quality) {
    case 'high':
      return { cell: d > 0 ? d / 1000 : 0, maxTexture: 4096 };
    case 'optimized':
      return { cell: d > 0 ? d / 300 : 0, maxTexture: 2048 };
    default:
      return { cell: 0, maxTexture: 0 };
  }
}

/**
 * A natív `exportModel` opciói: a néző megjelenése (forgatás) + formátum, egység-szorzó,
 * minőség, textúra. A glTF/USD egysége szabvány szerint méter → ott a szorzó mindig 1.
 */
export function exportOptionsJson(doc: Model3DDoc | undefined, mesh: Pick<Model3DMesh, 'bounds'>, s: ExportSettings): string {
  const spec = EXPORT_FORMATS[s.format];
  const q = modelRotation(doc);
  const { cell, maxTexture } = qualityParams(mesh.bounds, s.quality);
  return JSON.stringify({
    format: s.format,
    rotation: [q.x, q.y, q.z, q.w],
    scale: spec.units ? UNIT_SCALE[s.unit] : 1,
    cell,
    maxTexture,
    textures: s.textures,
  });
}

export type MeshUsage = 'preview' | 'feed' | 'ar' | 'print' | 'original';

/** felhasználásonkénti háromszög-plafon (az eredetinél sosem több) */
export const TRIANGLE_BUDGET: Record<Exclude<MeshUsage, 'original'>, number> = {
  preview: 30_000,
  feed: 100_000,
  ar: 300_000,
  print: 1_000_000,
};

export function targetTriangles(current: number, usage: MeshUsage): number {
  if (usage === 'original') {
    return current;
  }
  return Math.max(0, Math.min(current, TRIANGLE_BUDGET[usage]));
}

/** az egyszerűsítési arány (0–1]; 1 = nincs teendő */
export function decimationRatio(current: number, usage: MeshUsage): number {
  return current <= 0 ? 1 : targetTriangles(current, usage) / current;
}

/** export-figyelmeztetések (i18n-kulcsok) — nem tiltások, a user dönt */
export function exportWarnings(
  mesh: Pick<Model3DMesh, 'textured' | 'points' | 'triangles'>,
  format: ExportFormat,
  textures = true
): string[] {
  const spec = EXPORT_FORMATS[format];
  const out: string[] = [];
  if (mesh.textured && textures && !spec.textures) {
    out.push(spec.colors ? 'model3d.export.warnTextureToColors' : 'model3d.export.warnNoTexture');
  }
  if (mesh.points && !spec.pointCloud) {
    out.push('model3d.export.warnPointCloudToMesh');
  }
  if (format === 'stl' && mesh.triangles > TRIANGLE_BUDGET.print) {
    out.push('model3d.export.warnHeavyPrint');
  }
  return out;
}

/**
 * Biztonságos, ékezet-megtartó fájlnév. Az optimalizált/magas változat KÜLÖN néven
 * (`… (optimized).glb`) — sosem írja felül az eredeti minőségű kivitelt.
 */
export function exportFileName(projectName: string, format: ExportFormat, quality: ExportQuality = 'original'): string {
  const base =
    projectName
      .normalize('NFC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'model';
  const suffix = quality === 'original' ? '' : ` (${quality})`;
  return `${base}${suffix}.${EXPORT_FORMATS[format].ext}`;
}

// ── 🗄️ tárolási formátum (a projekt-létrehozáskor választott) ─────────────────────

/** a választható tárolási formátumok (mind egyetlen fájl, a néző mindet megnyitja) */
export const STORAGE_FORMATS: readonly MeshFormat[] = ['usdz', 'glb', 'obj', 'ply'];
export const DEFAULT_STORAGE_FORMAT: MeshFormat = 'usdz';

/**
 * A kért tárolási formátum → amibe a szken TÉNYLEG kerül (adatvesztés nélkül):
 *  • pontfelhő: GLB vagy PLY (más formátum nem visz pontot);
 *  • textúrás (fotogrammetria): USDZ vagy GLB (az OBJ több fájl, a PLY elveszítené a textúrát);
 *  • textúra nélküli háló / szoba: bármelyik.
 */
export function storedFormatFor(pref: MeshFormat | undefined, kind: { textured: boolean; points: boolean }): MeshFormat {
  const want = pref && STORAGE_FORMATS.includes(pref) ? pref : DEFAULT_STORAGE_FORMAT;
  if (kind.points) {
    return want === 'glb' ? 'glb' : 'ply';
  }
  if (kind.textured) {
    return want === 'glb' ? 'glb' : 'usdz';
  }
  return want;
}
