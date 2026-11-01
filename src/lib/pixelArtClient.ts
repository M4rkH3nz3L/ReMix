import { AlphaType, ColorType, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';

import { makeId } from '@/lib/id';
import { decodeFrame, encodeGif, frameRgba, pixelLayerScale, spriteSheetRgba, type PixelArt, type PixelFrame } from '@/lib/pixelArt';
import { projectMediaDir } from '@/lib/projectFolderClient';

/** 👾 Pixel art kép és fájl (Skia és fájlrendszer); a számolás a pure magban van. */
export function rgbaImage(rgba: Uint8Array, width: number, height: number): SkImage | null {
  return Skia.Image.MakeImage({ width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }, Skia.Data.fromBytes(rgba), width * 4);
}

const target = (ext: string): File => {
  const dir = projectMediaDir();
  if (!dir.exists) {
    dir.create();
  }
  return new File(dir, `${makeId('pix')}.${ext}`);
};

function writePng(rgba: Uint8Array, width: number, height: number): string {
  const image = rgbaImage(rgba, width, height);
  const bytes = image?.encodeToBytes(ImageFormat.PNG, 100);
  if (!bytes) {
    throw new Error('A pixel-kép nem kódolható.');
  }
  const file = target('png');
  file.write(bytes);
  return file.uri;
}

export const artFrames = (art: PixelArt): PixelFrame[] => art.frames.map((f) => decodeFrame(f, art.width, art.height));

/** Az első kocka a rétegre: elég nagy, hogy a dokumentum-export se mossa el a pixelt. */
export function writeLayerPng(art: PixelArt): string {
  const scale = pixelLayerScale(art.width, art.height);
  return writePng(frameRgba(artFrames(art)[0], art.width, art.height, art.palette, scale), art.width * scale, art.height * scale);
}

export function writePixelGif(art: PixelArt, scale: number): string {
  const file = target('gif');
  file.write(encodeGif(artFrames(art), art.width, art.height, art.palette, art.fps, scale));
  return file.uri;
}

export function writeSpriteSheet(art: PixelArt, scale: number): string {
  const sheet = spriteSheetRgba(artFrames(art), art.width, art.height, art.palette, scale);
  return writePng(sheet.rgba, sheet.width, sheet.height);
}
