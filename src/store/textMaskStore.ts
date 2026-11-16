import { create } from 'zustand';

import type { ImageDoc } from '@/types/project';

/**
 * ✂️🔤 A szöveg-vágások maszk-képei (IMAGE-PROD S18): kulcs (a szöveg alakja + helye, `textMaskKey`) →
 * a betűk fehér-fekete maszkja (a telefon rendereli, a cache-ben). Levezetett adat: nem kerül a
 * projektbe; ha hiányzik, a render előtt újra elkészül (`ensureTextClipMasks`).
 */
interface TextMaskState {
  map: ReadonlyMap<string, string>;
  put: (key: string, uri: string) => void;
}

/** a maszk-készítő (a `RenderStage` köti be — a lib-réteg komponenst nem importálhat) */
let ensurer: ((doc: ImageDoc) => Promise<void>) | null = null;
export function setTextMaskEnsurer(fn: ((doc: ImageDoc) => Promise<void>) | null): void {
  ensurer = fn;
}
/** a dokumentum szöveg-vágásainak maszkjai elkészülnek (ha van készítő); a szerveres render előtt */
export async function ensureTextMasksFor(doc: ImageDoc): Promise<void> {
  if (ensurer) await ensurer(doc);
}

export const useTextMasks = create<TextMaskState>((set, get) => ({
  map: new Map(),
  put: (key, uri) => {
    const next = new Map(get().map);
    next.set(key, uri);
    set({ map: next });
  },
}));
