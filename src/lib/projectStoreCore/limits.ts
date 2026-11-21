import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

// ── 📏 Látható limitek (figyelmeztetés nagy projektnél) ───────────────────────

/**
 * Egy AsyncStorage-érték fölött figyelmeztetünk: az Android (SQLite) alap-kurzor-
 * korlátja ~2 MB környékén kezd bukni. E fölött a mentés kockázatos → jelezzük.
 */
export const PROJECT_SIZE_WARN_BYTES = 2 * 1024 * 1024;

/** A szerializált projekt becsült mérete bájtban (az AsyncStorage-írás nagysága). */
export function estimateProjectBytes(project: Project): number {
  try {
    return JSON.stringify(project).length;
  } catch (caught) {
    logCaught('lib/storage.ts:estimateProjectBytes', caught);
    return 0;
  }
}

/** Igaz, ha a projekt a figyelmeztetési méret fölött van (a mentés kockázatos). */
export function isProjectTooLarge(project: Project): boolean {
  return estimateProjectBytes(project) > PROJECT_SIZE_WARN_BYTES;
}
