import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { logCaught } from '@/lib/logCaught';

let override: number | null = null;

/** 🧪 füstteszt: a betelt lemez ugyanazon a kódúton, a lemez tényleges teleírása nélkül */
export function setFreeDiskOverride(bytes: number | null): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    override = bytes;
  }
}

/** a készülék szabad helye (bájt); 0 = ismeretlen (a `diskSpace` döntései ekkor nem tiltanak) */
export function freeDiskBytes(): number {
  if (override !== null) {
    return override;
  }
  if (Platform.OS === 'web') {
    return 0;
  }
  try {
    return Paths.availableDiskSpace;
  } catch (caught) {
    logCaught('lib/diskSpaceClient.ts:freeDiskBytes', caught);
    return 0;
  }
}
