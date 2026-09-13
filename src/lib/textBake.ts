import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { renderServerUrl } from '@/lib/render';
import type { TextClip } from '@/types/project';

export interface BakedText {
  uri: string;
  /** a PNG mérete a bake-vásznon (px) */
  w: number;
  h: number;
  /** a bake-vászon mérete (px) — a normalizált forma-mérethez */
  canvasW: number;
  canvasH: number;
}

/**
 * 🔁 Text → Shape: a szövegklipet a teljes stílusával a worker átlátszó PNG-vé
 * süti (`/text/bake`), amit a médiatárba írunk. A hívó ebből forma-klipet
 * (kép-kitöltés) csinál, ami a forma-eszköztárral tovább animálható. INGYEN
 * (determinisztikus worker-render, `renderServerUrl`). `null`, ha nem elérhető.
 *
 * @param aspect a projekt szélesség/magasság aránya (a bake-vászonhoz)
 */
export async function bakeTextToImage(clip: TextClip, aspect: number): Promise<BakedText | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  // a bake-vászon az arányból: a hosszabb oldal 1280 px
  const canvas =
    aspect >= 1
      ? { w: 1280, h: Math.max(2, Math.round(1280 / aspect)) }
      : { w: Math.max(2, Math.round(1280 * aspect)), h: 1280 };
  const base = renderServerUrl();
  try {
    const res = await fetch(`${base}/text/bake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip, canvas }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { pngBase64?: string; w?: number; h?: number };
    if (!body.pngBase64) {
      return null;
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const file = new File(dir, `textshape_${Date.now().toString(36)}.png`);
    file.write(Uint8Array.from(atob(body.pngBase64), (c) => c.charCodeAt(0)));
    return {
      uri: file.uri,
      w: body.w ?? canvas.w,
      h: body.h ?? canvas.h,
      canvasW: canvas.w,
      canvasH: canvas.h,
    };
  } catch {
    return null;
  }
}
