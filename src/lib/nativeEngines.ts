import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform, TurboModuleRegistry } from 'react-native';
import { logCaught } from '@/lib/logCaught';

/**
 * 🔌 Natív AI-motor jelenlét-detektálás (local-ai). A JS-csomag telepítése ≠ a
 * natív modul jelenléte: a dev-client ÚJRABUILDELÉSÉIG a TurboModule nincs
 * regisztrálva — ilyenkor a katalógus őszintén `engine_missing`-et mutat.
 * Külön modul, hogy a `modelRegistryClient` ↔ `whisperClient` közt ne legyen
 * import-kör. Jest alatt a mock-olt registry null-t ad → false (determinista).
 */

/** whisper.rn natív modulja jelen van-e ebben a buildben */
export function whisperEngineAvailable(): boolean {
  try {
    return TurboModuleRegistry.get('RNWhisper') != null;
  } catch (caught) {
    logCaught('lib/nativeEngines.ts:whisperEngineAvailable', caught);
    return false;
  }
}

/** react-native-executorch natív modulja jelen van-e (Fázis B/D-hez) */
export function executorchEngineAvailable(): boolean {
  try {
    return TurboModuleRegistry.get('ExecutorchModule') != null;
  } catch (caught) {
    logCaught('lib/nativeEngines.ts:executorchEngineAvailable', caught);
    return false;
  }
}

/** 🔇 V8: a ReMix natív hang-AI magja (RNNoise C, iOS + Android) jelen van-e ebben a buildben */
export function nativeAudioEngineAvailable(): boolean {
  try {
    if (Platform.OS === 'web') return false;
    const m = requireOptionalNativeModule<{ rnnoiseLoad?: unknown }>('RemixRender');
    return typeof m?.rnnoiseLoad === 'function';
  } catch (caught) {
    logCaught('lib/nativeEngines.ts:nativeAudioEngineAvailable', caught);
    return false;
  }
}

/** 🎚️ V5: a Core ML futtató (stem-modell) jelen van-e — csak iOS */
export function coremlEngineAvailable(): boolean {
  try {
    if (Platform.OS !== 'ios') return false;
    const m = requireOptionalNativeModule<{ stemLoad?: unknown }>('RemixRender');
    return typeof m?.stemLoad === 'function';
  } catch (caught) {
    logCaught('lib/nativeEngines.ts:coremlEngineAvailable', caught);
    return false;
  }
}
