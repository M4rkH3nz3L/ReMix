import Constants from 'expo-constants';
import { t as tr } from 'i18next';

import {
  capabilityLabel,
  capabilityRequiresPro,
  type CapabilityId,
} from '@/lib/capabilities';
import { isSecureForRelease } from '@/lib/envConfig';
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
    return assertSecureUrl(hosted.replace(/\/+$/, ''));
  }
  return assertSecureUrl(renderServerUrl());
}

/**
 * 🔒 Titkosítatlan HTTP tiltása a RELEASE buildben.
 *
 * A worker felé a bejelentkezett felhasználó Supabase-tokenje, a BYOK AI-kulcsa
 * és a teljes projekt-médiája utazik. Sima HTTP-n ez lehallgatható/módosítható.
 * Release buildben az iOS ATS és az Android network-security-config amúgy is
 * BLOKKOLNÁ a `http://`-t — ott a hívás némán elhalna; így viszont beszédes hibát
 * kapunk, a fejlesztésben pedig (`__DEV__`) a helyi worker változatlanul megy.
 */
function assertSecureUrl(url: string): string {
  // dev: minden mehet; prod: csak https ÉS nem-loopback (lásd `@/lib/envConfig`)
  if (isSecureForRelease(url, __DEV__)) {
    return url;
  }
  throw new Error(tr('lib.backend.insecureUrl', { url }));
}

/** A művelet Pro-előfizetést igényel — a UI ezt paywallra fordítja. */
export class ProRequiredError extends Error {
  readonly capability: CapabilityId;
  constructor(cap: CapabilityId) {
    super(tr('lib.backend.proRequired', { label: capabilityLabel(cap) }));
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
