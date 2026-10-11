import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { docMediaUris } from '@/lib/imageDoc';
import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';
import type { ImageDoc } from '@/types/project';

/**
 * 🎨 Kép-dokumentum rasterizálása a workerrel.
 *
 * A réteg-fa az igazság, a PNG csak az eredménye — ezért a fájlnév a
 * dokumentum TARTALMÁBÓL képzett kulcsot kap: ha semmi nem változott, a
 * meglévő fájl megy vissza (nincs fölösleges render), ha bármit átállítottál,
 * új fájl születik, és a régi képklip nem íródik felül a hátad mögött.
 */
/** 🎨 Export-kimenet: formátum + minőség (a `/imagedoc`-nak továbbadva). */
export interface RenderImageOpts {
  format?: 'png' | 'jpg' | 'webp';
  /** 0–1 (csak jpg/webp) */
  quality?: number;
}

function contentKey(doc: ImageDoc, height: number, fmt: string, quality?: number): string {
  const src = JSON.stringify({
    a: doc.aspectRatio,
    w: doc.width,
    h: doc.height,
    f: doc.format,
    l: doc.layers,
    // a kimeneti variáns IS a kulcs része → 1×/2× és png/jpg/webp nem ütközik
    oh: height,
    of: fmt,
    oq: quality ?? null,
  });
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * 📄 A dokumentum (már legenerált, önálló) SVG-jéből nyomdakész VEKTOR-PDF a
 * workerrel (Chromium `page.pdf`). Az SVG-t FÁJLKÉNT töltjük fel (a beágyazott
 * fotóktól nagy lehet). A PDF a `document/media`-ba kerül; a hívó megosztja.
 */
export async function renderSvgPdf(svg: string, width: number, height: number): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    // az SVG-t cache-fájlba írjuk, hogy fájlként (ne mezőként) tölthessük fel
    const cache = new Directory(Paths.cache, 'export');
    if (!cache.exists) {
      cache.create();
    }
    const svgFile = new File(cache, `pdf_src_${Date.now().toString(36)}.svg`);
    if (svgFile.exists) {
      svgFile.delete();
    }
    svgFile.write(svg);

    const form = new FormData();
    form.append('svg', svgFile as unknown as Blob, 'doc.svg');
    form.append('width', String(Math.round(width)));
    form.append('height', String(Math.round(height)));

    const res = await uploadFetch(`${renderServerUrl()}/svg/pdf`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const target = new File(dir, `doc_${Date.now().toString(36)}.pdf`);
    target.write(new Uint8Array(await res.arrayBuffer()));
    return target.uri;
  } catch {
    return null;
  }
}

export async function renderImageDoc(
  doc: ImageDoc,
  // a vászon-magasság: a létrehozáskor választott `doc.height`, egyébként az alap.
  // (a szerver a szélességet az aspectRatióból számolja, és 2160-ra sapkázza)
  height = doc.height ?? 1280,
  opts: RenderImageOpts = {}
): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const fmt = opts.format === 'jpg' ? 'jpg' : opts.format === 'webp' ? 'webp' : 'png';
    const target = new File(dir, `doc_${doc.id}_${contentKey(doc, height, fmt, opts.quality)}.${fmt}`);
    if (target.exists) {
      return target.uri;
    }

    const form = new FormData();
    const uriMap: Record<string, string> = {};
    docMediaUris(doc).forEach((uri, i) => {
      const field = `f${i}`;
      uriMap[uri] = field;
      const file = new File(uri);
      if (file.exists) {
        form.append(field, file as unknown as Blob, file.name);
      }
    });
    form.append('doc', JSON.stringify(doc));
    form.append('uriMap', JSON.stringify(uriMap));
    form.append('height', String(height));
    if (opts.format) {
      form.append('format', fmt);
    }
    if (opts.quality != null) {
      form.append('quality', String(opts.quality));
    }

    const res = await uploadFetch(`${renderServerUrl()}/imagedoc`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      return null;
    }
    target.write(new Uint8Array(await res.arrayBuffer()));
    return target.uri;
  } catch {
    return null;
  }
}
