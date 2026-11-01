import { BlendMode, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';

import { imageCornersOnCanvas } from '@/lib/imageLayerGeometry';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { PhotoLayer } from '@/types/project';


/** Az alfából fehér: a felhő-kivágás RGBA, a maszk szürke. */
const ALPHA_TO_WHITE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];

/**
 * A fotó saját terében kapott maszk a teljes vászonra vetítve, a réteg elhelyezése, forgatása,
 * tükrözése és illesztése szerint. Az eredmény a festett maszkokkal azonos PNG, ecsettel javítható.
 */
export function projectMaskToCanvas(mask: SkImage, layer: PhotoLayer, photo: { width: number; height: number }, canvas: { width: number; height: number }, fromAlpha: boolean): string | null {
  const surface = Skia.Surface.MakeOffscreen(Math.round(canvas.width), Math.round(canvas.height));
  if (!surface) {
    return null;
  }
  const c = surface.getCanvas();
  const black = Skia.Paint();
  black.setColor(Skia.Color('#000000'));
  c.drawRect(Skia.XYWHRect(0, 0, canvas.width, canvas.height), black);
  const [a, b, d] = imageCornersOnCanvas(layer, photo.width / photo.height, canvas).map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
  c.save();
  c.concat(Skia.Matrix([(b.x - a.x) / mask.width(), (d.x - a.x) / mask.height(), a.x, (b.y - a.y) / mask.width(), (d.y - a.y) / mask.height(), a.y, 0, 0, 1]));
  const paint = Skia.Paint();
  if (fromAlpha) {
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(ALPHA_TO_WHITE));
    paint.setBlendMode(BlendMode.SrcOver);
  }
  c.drawImage(mask, 0, 0, paint);
  c.restore();
  surface.flush();
  const dir = projectMediaDir();
  if (!dir.exists) {
    dir.create();
  }
  const file = new File(dir, `brush_bg_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  return file.uri;
}
