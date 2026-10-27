/**
 * 📦 3D-export és -egyszerűsítés döntései (3D-Studio.md §3, §5, §9) — pure.
 *
 *  • formátum-képességmátrix: mi megy a KÉSZÜLÉKEN (ingyenes) és mi a felhőben (Pro);
 *  • felhasználás szerinti cél-háromszögszám (feed/AR/nyomtatás/előnézet);
 *  • export-figyelmeztetések (pl. STL-be nem kerül textúra) és biztonságos fájlnév.
 */
import type { MeshFormat, Model3DMesh } from '@/types/model3d';

export interface FormatSpec {
  format: MeshFormat;
  /** a készüléken készül (ModelIO) → ingyenes; különben a worker (Pro) */
  local: boolean;
  textures: boolean;
  /** hálót ír (STL/OBJ/USDZ/GLB) vagy pontfelhőt is (PLY) */
  pointCloud: boolean;
  /** tipikus felhasználás (i18n-kulcs) */
  useKey: string;
}

export const EXPORT_FORMATS: Record<MeshFormat, FormatSpec> = {
  usdz: { format: 'usdz', local: true, textures: true, pointCloud: false, useKey: 'model3d.export.useAr' },
  obj: { format: 'obj', local: true, textures: true, pointCloud: false, useKey: 'model3d.export.useEditing' },
  stl: { format: 'stl', local: true, textures: false, pointCloud: false, useKey: 'model3d.export.usePrint' },
  ply: { format: 'ply', local: true, textures: false, pointCloud: true, useKey: 'model3d.export.usePointCloud' },
  glb: { format: 'glb', local: false, textures: true, pointCloud: false, useKey: 'model3d.export.useWeb' },
};

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
export function exportWarnings(mesh: Pick<Model3DMesh, 'textured' | 'points' | 'triangles'>, format: MeshFormat): string[] {
  const spec = EXPORT_FORMATS[format];
  const out: string[] = [];
  if (mesh.textured && !spec.textures) {
    out.push('model3d.export.warnNoTexture');
  }
  if (mesh.points && !spec.pointCloud) {
    out.push('model3d.export.warnPointCloudToMesh');
  }
  if (format === 'stl' && mesh.triangles > TRIANGLE_BUDGET.print) {
    out.push('model3d.export.warnHeavyPrint');
  }
  return out;
}

/** biztonságos, ékezet-megtartó fájlnév (a megosztás-lapnak / külső tárnak) */
export function exportFileName(projectName: string, format: MeshFormat): string {
  const base =
    projectName
      .normalize('NFC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'model';
  return `${base}.${format}`;
}
