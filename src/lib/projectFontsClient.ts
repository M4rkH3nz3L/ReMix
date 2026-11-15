import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Font from 'expo-font';

import { logCaught } from '@/lib/logCaught';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { fontDisplayName, fontFamilyKey, isFontHeader } from '@/lib/projectFonts';
import type { ProjectFont } from '@/types/project';

/**
 * 🔤 Saját betűtípus — eszköz-réteg (IMAGE-PROD S10): import a Fájlokból a projekt mappájába, és a
 * futásidejű betöltés (expo-font), hogy a vászon és a telefonos render ugyanazt a betűt rajzolja.
 */

/** FNV-1a a fájl tartalmán — a család-kulcs része (ugyanaz a fájl → ugyanaz a család) */
function contentKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length.toString(36)}${h.toString(36)}`;
}

export type FontImportResult = { ok: true; font: ProjectFont } | { ok: false; reason: 'cancelled' | 'invalid' | 'fs' };

/** egy TTF/OTF fájl a projektbe (a fájl ellenőrizve: a tartalom font-fejléce dönt, nem a kiterjesztés) */
export async function importFontFromUri(sourceUri: string, fileName: string): Promise<FontImportResult> {
  try {
    const src = new File(sourceUri);
    const bytes = await src.bytes();
    if (!isFontHeader(bytes)) return { ok: false, reason: 'invalid' };
    const family = fontFamilyKey(fileName, contentKey(bytes));
    const ext = /\.otf$/i.test(fileName) || String.fromCharCode(...bytes.slice(0, 4)) === 'OTTO' ? 'otf' : 'ttf';
    const dir = projectMediaDir();
    if (!dir.exists) dir.create();
    const target = new File(dir, `font_${family}.${ext}`);
    if (!target.exists) src.copy(target);
    // a másolat iOS-en kis késéssel látszik (eszközön mérve ~300 ms): a betöltés előtt meg kell lennie
    for (let i = 0; i < 60 && !new File(target.uri).exists; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!new File(target.uri).exists) return { ok: false, reason: 'fs' };
    return { ok: true, font: { family, name: fontDisplayName(fileName), uri: target.uri } };
  } catch (caught) {
    logCaught('lib/projectFontsClient.ts:importFontFromUri', caught);
    return { ok: false, reason: 'fs' };
  }
}

/** a Fájlokból választott font importja */
export async function pickAndImportFont(): Promise<FontImportResult> {
  const result = await DocumentPicker.getDocumentAsync({
    // a fontok MIME-je eszközönként más (sokszor octet-stream) → szélesen, a tartalom dönt
    type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/x-font-otf', 'application/font-sfnt', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) return { ok: false, reason: 'cancelled' };
  const a = result.assets[0];
  return importFontFromUri(a.uri, a.name ?? 'font.ttf');
}

const loaded = new Set<string>();

/** a projekt fontjainak betöltése (egyszer családonként); a hibás fájl naplózva, a többit nem állítja meg */
export async function loadProjectFonts(fonts: readonly ProjectFont[] | undefined): Promise<void> {
  for (const f of fonts ?? []) {
    if (loaded.has(f.family) || Font.isLoaded(f.family)) {
      loaded.add(f.family);
      continue;
    }
    try {
      if (!new File(f.uri).exists) continue; // hiányzó média — a relink-út intézi
      await Font.loadAsync({ [f.family]: f.uri });
      loaded.add(f.family);
    } catch (caught) {
      logCaught('lib/projectFontsClient.ts:loadProjectFonts', caught);
    }
  }
}
