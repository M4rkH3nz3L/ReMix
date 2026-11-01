import { logCaught } from '@/lib/logCaught';

/**
 * 🧠 Memória-figyelmeztetésre a dekódolt képek gyorsítótára kiürül, és a dokumentum sértetlen marad:
 * a képek szükség esetén újratöltődnek. A jelzés a naplóba kerül, mert a következő lépés a kilövés.
 */
export function onMemoryWarning(clearImageCache: () => void): void {
  logCaught('lib/memoryPressure.ts:warning', new Error('Memória-figyelmeztetés'));
  try {
    clearImageCache();
  } catch (caught) {
    logCaught('lib/memoryPressure.ts:clear', caught);
  }
}
