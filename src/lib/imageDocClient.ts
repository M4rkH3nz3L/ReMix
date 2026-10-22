import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { ensureCloud } from '@/lib/backend';
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

/**
 * 🖼️ PSD-import (IMAGE 01.1): egy .psd fájlt felküld a worker `/psd/import`-jára,
 * ami beolvassa (ag-psd), réteg-fát `ImageDoc`-ra képezi, per-réteg PNG-ket a
 * média-tárba tölt, és a kész `ImageDoc`-ot adja vissza. A hívó EGY
 * `UPSERT_IMAGE_DOC` parancsként teszi a command-busra (undo-barát).
 *
 * Tier-gate: `ensureCloud('psdImport')` DOB (ProRequiredError), ha nincs Pro — a
 * UI ezt paywallra fordítja (guardPro). A worker SZERVER-hitelesen is gate-el (402).
 *
 * @param file a kiválasztott PSD (uri + név, lásd `pickPsd`)
 * @param projectId opcionális — a réteg-PNG-k projekt-rendezett kulcsot kapnak
 * @returns a beolvasott `ImageDoc`, vagy `null` (weben / hiba esetén a hívó kezeli)
 */
export async function importPsd(
  file: { uri: string; name: string },
  projectId?: string
): Promise<ImageDoc | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  // 🔒 tier-gate: nincs Pro → ProRequiredError (a UI guardPro-val paywallra fordítja)
  const base = ensureCloud('psdImport');

  const form = new FormData();
  const psd = new File(file.uri);
  if (!psd.exists) {
    return null;
  }
  form.append('psd', psd as unknown as Blob, file.name || 'import.psd');
  if (projectId) {
    form.append('projectId', projectId);
  }
  // a doc-nevet a fájlnévből (kiterjesztés nélkül) adjuk
  const docName = (file.name || 'PSD').replace(/\.[^.]+$/, '').slice(0, 120) || 'PSD import';
  form.append('name', docName);

  const res = await uploadFetch(`${base}/psd/import`, { method: 'POST', body: form });
  if (!res.ok) {
    // a worker barátságos (magyar) hibaüzenetet ad — azt dobjuk tovább
    let msg = 'A PSD-import nem sikerült.';
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // nem-JSON válasz — marad az alap üzenet
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { doc?: ImageDoc };
  return body?.doc ?? null;
}

/**
 * 📄 PDF-import (IMAGE 01.3): egy .pdf fájlt felküld a worker `/pdf/import`-jára,
 * ami beolvassa (pdf-lib struktúra), oldalanként `ImageDoc`-ra képezi, az oldal-PNG-ket
 * a média-tárba rasterizálja (pdfjs+canvas), és a kész `ImageDoc[]`-ot adja vissza
 * (oldalanként egy dokumentum, a galéria-lap konvenciója szerint). A hívó oldalanként
 * EGY `UPSERT_IMAGE_DOC` parancsként teszi a command-busra (undo-barát).
 *
 * Tier-gate: `ensureCloud('pdfImport')` DOB (ProRequiredError), ha nincs Pro — a UI
 * ezt guardPro-val paywallra fordítja. A worker SZERVER-hitelesen is gate-el (402).
 *
 * @param file a kiválasztott PDF (uri + név, lásd `pickPdf`)
 * @param projectId opcionális — az oldal-PNG-k projekt-rendezett kulcsot kapnak
 * @returns a beolvasott `ImageDoc[]` (oldalanként), vagy `null` (weben / lemondás)
 */
export async function importPdf(
  file: { uri: string; name: string },
  projectId?: string
): Promise<ImageDoc[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  // 🔒 tier-gate: nincs Pro → ProRequiredError (a UI guardPro-val paywallra fordítja)
  const base = ensureCloud('pdfImport');

  const form = new FormData();
  const pdf = new File(file.uri);
  if (!pdf.exists) {
    return null;
  }
  form.append('pdf', pdf as unknown as Blob, file.name || 'import.pdf');
  if (projectId) {
    form.append('projectId', projectId);
  }
  // a doc-alapnevet a fájlnévből (kiterjesztés nélkül) adjuk; az oldalszám-utótagot a worker fűzi
  const docName = (file.name || 'PDF').replace(/\.[^.]+$/, '').slice(0, 120) || 'PDF import';
  form.append('name', docName);

  const res = await uploadFetch(`${base}/pdf/import`, { method: 'POST', body: form });
  if (!res.ok) {
    // a worker barátságos (magyar) hibaüzenetet ad — azt dobjuk tovább
    let msg = 'A PDF-import nem sikerült.';
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // nem-JSON válasz — marad az alap üzenet
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { docs?: ImageDoc[] };
  return Array.isArray(body?.docs) ? body.docs : null;
}

/**
 * 🖼️ PSD-export (IMAGE 01.2): az `ImageDoc`-ot felküldi a worker `/psd/export`-jára,
 * ami RÉTEG-MEGŐRZÉSSEL (NEM flatten!) felépíti a .psd-t (ag-psd), a média-tárba
 * tölti, és a letölthető URL-t adja vissza. A kliens letölti a `document/media`-ba,
 * és megosztja. A `importPsd` PÁRJA.
 *
 * Tier-gate: `ensureCloud('psdExport')` DOB (ProRequiredError), ha nincs Pro — a
 * UI guardPro-val paywallra fordítja. A worker SZERVER-hitelesen is gate-el (402).
 *
 * @param doc a kép-dokumentum (réteg-fa)
 * @param projectId opcionális — a PSD projekt-rendezett kulcsot kap a tárban
 * @returns a letöltött .psd helyi uri-ja, vagy `null` (weben / hiba esetén)
 */
export async function exportPsd(doc: ImageDoc, projectId?: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  // 🔒 tier-gate: nincs Pro → ProRequiredError (a UI guardPro-val paywallra fordítja)
  const base = ensureCloud('psdExport');

  const res = await uploadFetch(`${base}/psd/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc, ...(projectId ? { projectId } : {}) }),
  });
  if (!res.ok) {
    // a worker barátságos (magyar) hibaüzenetet ad — azt dobjuk tovább
    let msg = 'A PSD-export nem sikerült.';
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        msg = body.error;
      }
    } catch {
      // nem-JSON válasz — marad az alap üzenet
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { url?: string; name?: string };
  if (!body?.url) {
    return null;
  }

  // a kész .psd-t a document/media-ba töltjük (a többi export-letöltés mintája)
  try {
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const fileName = (body.name || `${doc.id}.psd`).replace(/[^\w.-]+/g, '_');
    const target = new File(dir, `psd_${Date.now().toString(36)}_${fileName}`);
    const dl = await fetch(body.url);
    if (!dl.ok) {
      return null;
    }
    target.write(new Uint8Array(await dl.arrayBuffer()));
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
