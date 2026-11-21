import type { ProjectEvent } from '@/lib/commands';
import type { Project } from '@/types/project';

/** 🕓 Projekt-verzió (pillanatkép): a projekt TELJES állapota egy néven, on-device. */
export interface ProjectVersion {
  id: string;
  name: string;
  /** ISO időbélyeg */
  at: string;
  project: Project;
  /** kézi pillanatkép vagy automatikus autosave-előzmény (hiányzó = manual) */
  kind?: 'manual' | 'auto';
}

// ── 🛟 Crash-recovery (félbeszakadt/bukott mentés elleni védelem) ─────────────

/** A recovery-pillanatkép: a legutóbbi szerkesztői állapot a FŐ mentéstől külön kulcson. */
export interface RecoverySnapshot {
  /** ISO időbélyeg — a pillanatkép készítésének ideje */
  at: string;
  project: Project;
  events: ProjectEvent[];
}

/**
 * Van-e NEM MENTETT munka: a recovery-pillanatkép frissebb-e a mentett projektnél.
 * Pure → a szerkesztő-indításkori „visszaállítod?" ajánlat döntése tesztelhető.
 */
export function recoveryIsFresher(recoveryAt: string, savedUpdatedAt: string | undefined): boolean {
  if (!savedUpdatedAt) {
    return true;
  }
  return recoveryAt.localeCompare(savedUpdatedAt) > 0;
}
