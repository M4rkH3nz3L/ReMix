import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProjectEvent } from '@/lib/commands';
import { eventsKey } from '@/lib/projectStoreCore/keys';
import { logCaught } from '@/lib/logCaught';

/** Az eseménynapló a projekt mellett, külön kulcson él — az undo nem érinti. */
export async function saveEvents(projectId: string, events: ProjectEvent[]): Promise<void> {
  await AsyncStorage.setItem(eventsKey(projectId), JSON.stringify(events));
}

export async function loadEvents(projectId: string): Promise<ProjectEvent[]> {
  const raw = await AsyncStorage.getItem(eventsKey(projectId));
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as ProjectEvent[];
  } catch (caught) {
    logCaught('lib/storage.ts:loadEvents', caught);
    return [];
  }
}
