import Constants from 'expo-constants';

import {
  capabilityLabel,
  capabilityRequiresPro,
  type CapabilityId,
} from '@/lib/capabilities';
import { isProNow } from '@/store/entitlementStore';

/**
 * 🔀 Backend-router — a worker-címek és a felhő-kapu EGYETLEN forrása.
 *
 * Két dolgot old meg:
 *   1. CÍM: a fizetős felhő-worker HOSZTOLT címe (`EXPO_PUBLIC_CLOUD_URL`),
 *      NEM a fejlesztői gép. Dev-ben, ha nincs beállítva, visszaesik a lokális
 *      dev-workerre (`renderServerUrl()`), hogy a fejlesztés zökkenőmentes.
 *   2. KAPU: mielőtt egy Pro-funkció a workerhez fordulna, itt ellenőrizzük az
 *      előfizetést. Nincs Pro → `ProRequiredError`, amit a UI paywallra fordít
 *      (a hívás EL SEM indul, nem terheljük feleslegesen a fizetős infrát).
 *
 * Így a ~15 `*Client` modul egyetlen egysoros `ensureCloud(cap)` hívással
 * gate-elhető, anélkül hogy mindegyikbe külön előfizetés-logika kerülne.
 */

const RENDER_PORT = 8787;

/**
 * A dev worker (server/, :8787) elérési címe — EGY forrás minden kliensnek,
 * hogy SOHA ne kelljen kézzel URL-t átírni szimulátor ↔ fizikai telefon között.
 * Feloldási sorrend:
 *   1. EXPO_PUBLIC_SERVER_URL  — teljes cím (pl. tunnel/távoli worker), mindent felülír
 *   2. EXPO_PUBLIC_SERVER_HOST — csak a hoszt (IP/hostname), a port marad 8787
 *   3. az Expo hostUri gépe    — a Metró ugyanazon a gépen fut, mint a worker
 *   4. localhost               — utolsó mentsvár
 * EXPO_PUBLIC_* értékek a bundle-be égnek → módosítás után Metro-újraindítás kell.
 */
export function renderServerUrl(): string {
  const fullUrl = process.env.EXPO_PUBLIC_SERVER_URL?.trim();
  if (fullUrl) {
    return fullUrl.replace(/\/+$/, '');
  }
  const host =
    process.env.EXPO_PUBLIC_SERVER_HOST?.trim() ||
    Constants.expoConfig?.hostUri?.split(':')[0] ||
    'localhost';
  return `http://${host}:${RENDER_PORT}`;
}

/**
 * A fizetős felhő-worker bázis-URL-je.
 *   1. EXPO_PUBLIC_CLOUD_URL — a hosztolt render/AI szolgáltatásunk (prod)
 *   2. renderServerUrl()     — dev-fallback (a helyi worker a Metró gépén)
 */
export function cloudBaseUrl(): string {
  const hosted = process.env.EXPO_PUBLIC_CLOUD_URL?.trim();
  if (hosted) {
    return hosted.replace(/\/+$/, '');
  }
  return renderServerUrl();
}

/** A művelet Pro-előfizetést igényel — a UI ezt paywallra fordítja. */
export class ProRequiredError extends Error {
  readonly capability: CapabilityId;
  constructor(cap: CapabilityId) {
    super(`A(z) „${capabilityLabel(cap)}" funkció Remix Pro-előfizetést igényel.`);
    this.name = 'ProRequiredError';
    this.capability = cap;
  }
}

export function isProRequiredError(e: unknown): e is ProRequiredError {
  return (
    e instanceof ProRequiredError ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'ProRequiredError')
  );
}

/**
 * Kapu egy felhő-művelet elé. Ha a képesség Pro-t igényel és a felhasználó nem
 * Pro → dob (a hálózati hívás el sem indul). Visszaadja a felhő bázis-URL-t, a
 * hívó így egy sorban intézi a gate-et ÉS a címfeloldást:
 *
 *   const base = ensureCloud('autoCaption');
 *   const res = await fetch(`${base}/captions`, …);
 */
export function ensureCloud(cap: CapabilityId): string {
  if (capabilityRequiresPro(cap) && !isProNow()) {
    throw new ProRequiredError(cap);
  }
  return cloudBaseUrl();
}

/** Igaz, ha a képesség MOST elérhető a felhasználónak (nem dob, csak kérdez). */
export function canUseCloud(cap: CapabilityId): boolean {
  return !capabilityRequiresPro(cap) || isProNow();
}
