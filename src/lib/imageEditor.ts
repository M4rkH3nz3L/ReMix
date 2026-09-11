import { Directory, File, Paths } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { makeId } from '@/lib/id';

/**
 * 🖼️ Kép Stúdió — on-device (ESZKÖZÖN futó) képszerkesztő műveletek.
 *
 * MINDEN művelet a telefonon fut az `expo-image-manipulator`-ral (natív),
 * SEMMI nem megy a workerre. A `saveAsync` a cache-be ír, ezért az eredményt
 * tartós helyre (`document/media`) másoljuk — mint a `captureFrame` —, hogy a
 * projekttel együtt megmaradjon és a Collect/relink is megtalálja.
 *
 * A geometriai műveletek (vágás, forgatás, tükrözés, átméretezés) itt élnek;
 * a rárajzolt markup/szöveg bake-elése a nézet-capture úton történik (lásd a
 * Kép Stúdió modalt), és ugyanide, `document/media`-ba ment.
 */

export type ImageOp =
  | { type: 'rotate'; degrees: number }
  | { type: 'flip'; axis: 'horizontal' | 'vertical' }
  /** vágás PIXELBEN az eredeti képen (bal-felső sarok + méret) */
  | { type: 'crop'; originX: number; originY: number; width: number; height: number }
  /** átméretezés; a hiányzó oldal arányt tart */
  | { type: 'resize'; width?: number; height?: number };

export interface BakedImage {
  uri: string;
  width: number;
  height: number;
}

function mediaDir(): Directory {
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

/** PNG-t őrzünk (alfa-csatorna, pl. háttér-eltávolítás után), különben JPEG. */
function formatFor(uri: string): { format: SaveFormat; ext: string } {
  return /\.png(\?|$)/i.test(uri)
    ? { format: SaveFormat.PNG, ext: 'png' }
    : { format: SaveFormat.JPEG, ext: 'jpg' };
}

/** Eredeti pixelméret — a vágó-keret és az arányok kiszámításához. */
export async function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  return { width: ref.width, height: ref.height };
}

/**
 * A megadott műveletsor beégetése (eszközön).
 *
 * `persist: false` (alap a szerkesztés KÖZBEN) → a cache-ben marad, hogy a
 * köztes lépések ne szemeteljék a media mappát. `persist: true` (a „Kész"
 * gombra) → tartós `document/media` fájl, amit a klipre teszünk.
 */
export async function bakeImage(
  uri: string,
  ops: ImageOp[],
  opts: { persist?: boolean } = {}
): Promise<BakedImage> {
  const ctx = ImageManipulator.manipulate(uri);
  for (const op of ops) {
    if (op.type === 'rotate') {
      ctx.rotate(op.degrees);
    } else if (op.type === 'flip') {
      ctx.flip(op.axis === 'horizontal' ? FlipType.Horizontal : FlipType.Vertical);
    } else if (op.type === 'crop') {
      ctx.crop({
        originX: Math.max(0, Math.round(op.originX)),
        originY: Math.max(0, Math.round(op.originY)),
        width: Math.max(1, Math.round(op.width)),
        height: Math.max(1, Math.round(op.height)),
      });
    } else if (op.type === 'resize') {
      ctx.resize({ width: op.width, height: op.height });
    }
  }
  const ref = await ctx.renderAsync();
  const { format, ext } = formatFor(uri);
  const saved = await ref.saveAsync({ format, compress: 0.92 });
  if (!opts.persist) {
    return { uri: saved.uri, width: saved.width, height: saved.height };
  }
  const target = new File(mediaDir(), `edit_${makeId('img')}.${ext}`);
  new File(saved.uri).copy(target);
  return { uri: target.uri, width: saved.width, height: saved.height };
}

/**
 * Egy már kirajzolt (capture-elt) fájl tartós helyre mentése a media mappába.
 * A markup/szöveg-bake (view-shot) a cache-be ír; ezzel tesszük maradandóvá.
 */
export function persistToMedia(cacheUri: string): string {
  const { ext } = formatFor(cacheUri);
  const target = new File(mediaDir(), `edit_${makeId('img')}.${ext}`);
  new File(cacheUri).copy(target);
  return target.uri;
}
