import type { Detent } from '@/lib/panelLayout';
import { IMAGE_SHEET_SPECS, type ImageSheetId } from '@/lib/panelSpecs';
import { pathEditView } from '@/lib/vectorPath';
import type { ImageDoc } from '@/types/project';

/**
 * 🖼️ A Kép Stúdió törzsének (`ImageStudioBody`) expo-mentes, tiszta magja — VISELKEDÉS-MEGŐRZŐ
 * kiemelés: a lap induló detentje, a precíziós mód és a szerkesztett útvonal levezetése.
 */

/** MOBILE-UI §6.6: a lap induló detentje — a felhasználó utolsó választása, különben a lap alapja */
export function initialSheetDetent(memory: Partial<Record<ImageSheetId, Detent>>, next: ImageSheetId): Detent {
  return memory[next] ?? IMAGE_SHEET_SPECS[next].initialDetent ?? 'peek';
}

/** a precíziós módot jelző állapotok (kivágás, toll, node, kijelölés, lasszó, pálca, ecset, vonalzó) */
export interface PrecisionFlags {
  cropRect: unknown;
  penPoints: unknown;
  pathEditId: unknown;
  selectTool: unknown;
  lassoActive: boolean;
  wandActive: boolean;
  brushActive: boolean;
  guidesActive: boolean;
}

/** 🎯 precíziós mód: a felső sáv és a lap-strip elrejtve → a vászon kapja a helyet (§3.3) */
export function isPrecisionMode(f: PrecisionFlags): boolean {
  return !!f.cropRect || !!f.penPoints || !!f.pathEditId || !!f.selectTool || f.lassoActive || f.wandActive || f.brushActive || f.guidesActive;
}

/** ✏️ a szerkesztett path: a nyers réteg, a gyűrű-nézete és a gyűrűk száma */
export function pathEditTarget(doc: ImageDoc | null, pathEditId: string | null, pathEditRing: number) {
  const pe = pathEditId && doc ? doc.layers.find((l) => l.id === pathEditId) ?? null : null;
  const rawPathShape = pe && pe.kind === 'shape' && pe.shape === 'path' ? pe : null;
  const pathEditShape = rawPathShape ? pathEditView(rawPathShape, pathEditRing) : null;
  const ringCount = rawPathShape?.subpaths?.length ?? 0;
  return { rawPathShape, pathEditShape, ringCount };
}
