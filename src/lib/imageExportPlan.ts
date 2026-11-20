/**
 * 🖨️ A Kép Stúdió export-rétegének (`useImageExport`) expo-mentes, tiszta magja — VISELKEDÉS-MEGŐRZŐ
 * kiemelés: a render-magasság alapértéke, a vászon-pillanatkép képpont-mérete, a telefonos PDF
 * raszter-magassága, a beágyazható fotó-réteg és a hivatkozható videó-projektek listája.
 */

/** a raszter magassága: a kért, különben a lapé, különben 1280 */
export function rasterHeightOf(target: { height?: number }, height: number | undefined): number {
  return height ?? target.height ?? 1280;
}

/** a view-shot a méretet képpontban várja — a dokumentum felbontására kérjük a képet */
export function captureViewSize(height: number, canvas: { width: number; height: number }, ratio: number): { width: number; height: number } {
  return {
    width: Math.round((height * (canvas.width / canvas.height)) / ratio),
    height: Math.round(height / ratio),
  };
}

/** 📄 S14: a telefonos PDF képe legfeljebb 4096 px magas */
export function pdfRasterHeight(canvasHeight: number): number {
  return Math.min(4096, canvasHeight);
}

/** a beágyazandó (helyi fájlra mutató) fotó-réteg */
export function isEmbeddablePhoto(l: { kind: string; uri?: unknown }): l is { kind: 'photo'; uri: string } {
  return l.kind === 'photo' && typeof l.uri === 'string' && l.uri.startsWith('file://');
}

/** 🖼️→🎬 a választható videó-projektek: csak videó (a régi, fajta nélküli is), nem önmaga, legfeljebb 8 */
export function linkableVideoProjects<M extends { id: string; kind?: string }>(metas: M[], currentId: string | undefined): M[] {
  return metas.filter((m) => (m.kind ?? 'video') === 'video' && m.id !== currentId).slice(0, 8);
}
