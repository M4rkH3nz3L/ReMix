import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProjectEvent } from '@/lib/commands';
import { migrateProject } from '@/lib/projectUtils';
import { recoveryKey } from '@/lib/projectStoreCore/keys';
import type { RecoverySnapshot } from '@/lib/projectStoreCore/snapshots';
import { rebaseStoredUris } from '@/lib/projectStoreClient/storedUris';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * Recovery-pillanatkép írása (az autosave hívja a FŐ mentés ELŐTT). Ha a fő mentés
 * elhasal vagy az app meghal, ez a kulcs őrzi a legutóbbi állapotot. Best-effort.
 */
export async function writeRecovery(project: Project, events: ProjectEvent[]): Promise<void> {
  const snap: RecoverySnapshot = { at: new Date().toISOString(), project, events };
  try {
    await AsyncStorage.setItem(recoveryKey(project.id), JSON.stringify(snap));
  } catch (caught) {
    logCaught('lib/storage.ts:writeRecovery', caught);
    // best-effort — a recovery hiánya nem buktathatja a szerkesztést
  }
}

export async function readRecovery(id: string): Promise<RecoverySnapshot | null> {
  const stored = await AsyncStorage.getItem(recoveryKey(id));
  if (!stored) {
    return null;
  }
  try {
    const { raw } = await rebaseStoredUris(stored);
    const snap = JSON.parse(raw) as RecoverySnapshot;
    if (!snap || !snap.project || typeof snap.at !== 'string') {
      return null;
    }
    return { at: snap.at, project: migrateProject(snap.project), events: snap.events ?? [] };
  } catch (caught) {
    logCaught('lib/storage.ts:readRecovery', caught);
    return null;
  }
}

export async function clearRecovery(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(recoveryKey(id));
  } catch (caught) {
    logCaught('lib/storage.ts:clearRecovery', caught);
    // best-effort
  }
}
