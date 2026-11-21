/** 🧪 Füstteszt — a build környezete: van-e felhő, és a Mac próbafájl-szerverének címe. (Áthelyezve: shared; viselkedés-változás nélkül.) */
import { cloudAvailable, serverHost } from '@/lib/backend';
import Constants from 'expo-constants';

/** van-e felhő ebben a buildben (dev: a helyi worker; release: csak beállított `EXPO_PUBLIC_CLOUD_URL`-lel) */
export function cloudInThisBuild(): boolean {
  return cloudAvailable();
}
/** 🧪 a Mac próbafájl-szervere (8799) a Metro címén — Wi-Fin és USB-n (169.254) is */
export function smokeFileHost(): string {
  // release-mérésnél nincs Metro-cím: a build idején megadott Mac-cím
  const fixed = process.env.EXPO_PUBLIC_SMOKE_HOST?.trim();
  return `http://${fixed || serverHost(undefined, Constants.expoConfig?.hostUri, true)}:8799`;
}
