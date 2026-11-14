import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { logCaught } from '@/lib/logCaught';
import type { PowerState } from '@/lib/thermalPolicy';

/** 🌡️ S19: a natív hő- és akkumulátor-állapot (`RemixRender.powerState`); régi build / web → null */
const mod = Platform.OS === 'web' ? null : requireOptionalNativeModule<{ powerState?: () => Promise<PowerState> }>('RemixRender');

export async function readPowerState(): Promise<PowerState | null> {
  if (!mod || typeof mod.powerState !== 'function') {
    return null;
  }
  try {
    return await mod.powerState();
  } catch (e) {
    logCaught('powerState', e);
    return null;
  }
}
