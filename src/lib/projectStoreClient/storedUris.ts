import { rebaseDocumentUris } from '@/lib/docUri';
import { logCaught } from '@/lib/logCaught';

/**
 * 📂 A tárolt JSON régi iOS-konténeres `file://` uri-jainak átírása az AKTUÁLIS
 * Documents-mappára (újratelepítés/frissítés után a konténer-azonosító változhat —
 * lásd `docUri.ts`). Best-effort: FS-modul nélkül (teszt/web) változatlan.
 */
export async function rebaseStoredUris(raw: string): Promise<{ raw: string; rebased: boolean }> {
  try {
    const { Paths } = await import('expo-file-system');
    const next = rebaseDocumentUris(raw, Paths.document.uri);
    return { raw: next, rebased: next !== raw };
  } catch (caught) {
    logCaught('lib/storage.ts:rebaseStoredUris', caught);
    return { raw, rebased: false };
  }
}
