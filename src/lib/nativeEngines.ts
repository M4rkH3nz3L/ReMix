import { TurboModuleRegistry } from 'react-native';

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
  } catch {
    return false;
  }
}

/** react-native-executorch natív modulja jelen van-e (Fázis B/D-hez) */
export function executorchEngineAvailable(): boolean {
  try {
    return TurboModuleRegistry.get('ExecutorchModule') != null;
  } catch {
    return false;
  }
}
