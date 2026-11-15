import type { ImageDoc } from '@/types/project';

/**
 * 🖨️ A telefonos render-színpadok regisztere (CORE K1/K2/K5): a felcsatolt `RenderStage`-ek közül a
 * legutóbbi az aktív. Így a stúdión kívülről (a videó-szerkesztő frissítő sávja, a feed-poszter)
 * is a telefonon renderelhető egy kép-dokumentum, szerver nélkül. Expo-mentes.
 */

export interface RenderStageOptions {
  format?: 'png' | 'jpg' | 'webp';
  quality?: number;
}

export interface RenderStageHandle {
  /** a dokumentum képe `heightPx` magasan; `null`, ha nem sikerült (a hiba naplózva) */
  render(doc: ImageDoc, heightPx: number, opts?: RenderStageOptions): Promise<string | null>;
}

const mounted: RenderStageHandle[] = [];

/** egy színpad felcsatolása; a visszaadott függvény leveszi */
export function registerRenderStage(handle: RenderStageHandle): () => void {
  mounted.push(handle);
  return () => {
    const i = mounted.lastIndexOf(handle);
    if (i >= 0) mounted.splice(i, 1);
  };
}

/** van-e most felcsatolt színpad */
export function hasRenderStage(): boolean {
  return mounted.length > 0;
}

/** a dokumentum képe a telefonon; `null`, ha nincs felcsatolt színpad vagy nem sikerült */
export function renderOnDevice(doc: ImageDoc, heightPx: number, opts?: RenderStageOptions): Promise<string | null> {
  const stage = mounted[mounted.length - 1];
  return stage ? stage.render(doc, heightPx, opts) : Promise.resolve(null);
}
