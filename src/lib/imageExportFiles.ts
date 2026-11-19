/**
 * 📁 A Kép Stúdió export-fájlneveinek és -típusainak pure magja (expo-mentes). VISELKEDÉS-MEGŐRZŐ
 * kiemelés az `ImageStudioBody`-ból: a két útvonal (SVG / PDF) szándékosan eltérő tisztítást használ,
 * ahogy eddig is.
 */

/** az önálló SVG fájlneve: ami nem betű/szám/`_`/`.`/`-`, az `_` lesz */
export function svgExportFileName(docName: string | undefined): string {
  return `${(docName || 'image').replace(/[^\w.-]+/g, '_')}.svg`;
}

/** a telefonos PDF fájlneve: Unicode-betű és -szám marad (ékezet is), minden más `_` */
export function pdfExportFileName(docName: string | undefined): string {
  return `${(docName || 'image').replace(/[^\p{L}\p{N}_-]+/gu, '_')}.pdf`;
}

/** a beágyazott fotó MIME-típusa a kiterjesztésből (png / webp, minden más jpeg) */
export function imageMimeForUri(uri: string): string {
  const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}
