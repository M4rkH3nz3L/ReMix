/** 🧪 Füstteszt — kép-dekódolás, pixel-olvasás és képeltérés-mérés (Skia), próbafájlok. (Áthelyezve: shared; viselkedés-változás nélkül.) */
import { type SkImage, Skia, ColorType, AlphaType, ImageFormat } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { projectMediaDir } from '@/lib/projectFolderClient';

export async function decode(uri: string): Promise<SkImage> {
  const bytes = await new File(uri).bytes();
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!img) {
    throw new Error(`nem dekódolható: ${uri}`);
  }
  return img;
}
export function pixel(img: SkImage, x: number, y: number): number[] {
  const px = img.readPixels(x, y, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return px ? [...px] : [];
}
/** átlátszó vászon, közepén piros négyzet — az alfa-megőrzés próbájához */
export function alphaImage(format: ImageFormat, ext: string): string {
  const surface = Skia.Surface.MakeOffscreen(64, 64)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#ff0000'));
  surface.getCanvas().drawRect(Skia.XYWHRect(20, 20, 24, 24), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_alpha_${Date.now().toString(36)}.${ext}`);
  file.write(surface.makeImageSnapshot().encodeToBytes(format));
  return file.uri;
}
export function removeFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    /* takarítás — best-effort */
  }
}
/** Mérési segéd: két kép eltérése rácspontonként (alfa + szín, ahol mindkettő fedő). */
export function gridDiff(a: SkImage, b: SkImage, size: number, stop: number): { bad: number; total: number } {
  let bad = 0;
  let total = 0;
  for (let y = 8; y < stop; y += 12) {
    for (let x = 8; x < size; x += 12) {
      total += 1;
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      const color = p[3] > 128 && q[3] > 128 ? Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - q[k]))) : 0;
      if (Math.abs(p[3] - q[3]) > 70 || color > 40) {
        bad += 1;
      }
    }
  }
  return { bad, total };
}
export function meanDiff(a: SkImage, b: SkImage, size: number, stop: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 5; y < stop; y += 7) {
    for (let x = 5; x < size - 5; x += 7) {
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      sum += (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
      n += 1;
    }
  }
  return sum / n;
}
export function spread(a: SkImage, x0: number, y0: number, n: number): number {
  const v: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v.push(pixel(a, x0 + x, y0 + y)[1]);
  const m = v.reduce((p, c) => p + c, 0) / v.length;
  return Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length);
}
