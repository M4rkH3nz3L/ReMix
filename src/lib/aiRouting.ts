/**
 * 🧭 On-device / server / hybrid AI-routing — tiszta döntés-mag (Ai §06.1).
 *
 * Determinista politika: olcsó/kis/offline feladat az ESZKÖZÖN (ha van hozzá lokál
 * modell), drága/nagy a WORKEREN (jobb modell). A modalitás a COMPUTE-fajta
 * (transcribe/embed/vision/text/smallText) — NEM a profil-`AiTask` (assistant/autoEdit…,
 * `@/lib/aiProviders`), az a provider-hozzárendelés tengelye. Expo-mentes, tiszta →
 * önmagában tesztelt. A hívó (`ai.ts`/`*Client.ts`) ebből választ célt.
 *
 * FONTOS: a routing SOHA nem kerüli meg a meteringet — a `server`/`hybrid` út
 * szerver-oldala továbbra is méri az aiTokens/cloudJobs-ot (`server/usage.js`); ez a
 * mag csak a CÉLT választja. Offline + nincs lokál modell → `server` (sorban áll,
 * míg online nem lesz), nincs crash.
 */

export type AiModality = 'transcribe' | 'embed' | 'vision' | 'text' | 'smallText';
export type AiTarget = 'device' | 'server' | 'hybrid';
export type NetworkState = 'online' | 'offline';
export type SizeHint = 'small' | 'medium' | 'large';

export interface DeviceCaps {
  /** mely modalitásokat tud lokálisan futtatni (a modell jelen van az eszközön) */
  modalities?: AiModality[];
}

export interface RouteInput {
  modality: AiModality;
  /** a bemenet nagyságrendje (alap 'medium') */
  size?: SizeHint;
  /** hálózati állapot (alap 'online') */
  network?: NetworkState;
  /** előfizetői szint (alap 'free') */
  tier?: string;
  device?: DeviceCaps;
}

export interface RouteDecision {
  target: AiTarget;
  reason: string;
}

/** A fizetős szintek (minőség-preferencia); a free/basic kvótát spórol → eszköz-preferencia. */
const PAID_TIERS = new Set(['pro', 'ultra', 'business']);

/** Tudja-e az eszköz lokálisan futtatni az adott modalitást. */
export function deviceCanRun(device: DeviceCaps | undefined, modality: AiModality): boolean {
  return !!device?.modalities?.includes(modality);
}

/** Igényel-e szerver-utat a cél (→ a hívónak meterelni/authozni kell). */
export function usesServer(target: AiTarget): boolean {
  return target !== 'device';
}

/**
 * A feladat futtatási célja. Determinista: azonos input → azonos cél.
 * Sorrend: offline → eszköz-képesség → méret × tier.
 */
export function routeAiTask(input: RouteInput): RouteDecision {
  const size = input.size ?? 'medium';
  const network = input.network ?? 'online';
  const capable = deviceCanRun(input.device, input.modality);
  const paid = PAID_TIERS.has(input.tier ?? 'free');

  if (network === 'offline') {
    return capable
      ? { target: 'device', reason: 'offline_device' }
      : { target: 'server', reason: 'offline_queued' }; // sorban áll, míg online nem lesz
  }

  if (!capable) {
    return { target: 'server', reason: 'no_device_model' };
  }

  // online + van lokál modell: méret és tier dönt
  if (size === 'small') {
    return { target: 'device', reason: 'small_on_device' };
  }
  if (size === 'large') {
    // fizetős → szerver (nagy modell/minőség); ingyenes → hibrid (eszköz elő-pass a token-spórolásért)
    return paid
      ? { target: 'server', reason: 'large_server_quality' }
      : { target: 'hybrid', reason: 'large_free_hybrid' };
  }
  // medium: fizetős → hibrid (eszköz elő-pass + szerver finomít), ingyenes → eszköz (kvóta-spórolás)
  return paid
    ? { target: 'hybrid', reason: 'medium_paid_hybrid' }
    : { target: 'device', reason: 'medium_free_device' };
}

// ── 🎙️ átirat-útvonal (06.1 + BP-9): eszköz-első vagy worker-első ─────────────

/** e fölött az eszközön számolt átirat-idő már túl hosszú (inkább a worker) */
export const MAX_DEVICE_TRANSCRIBE_SEC = 10 * 60;

export interface TranscriptionRouteInput {
  /** az átírandó anyag hossza (mp) */
  durationSec: number;
  tier?: string;
  network?: NetworkState;
  /** van-e használható (letöltött + próbázott) eszköz-modell */
  deviceModel: boolean;
  /** a mért valós-idő-arány (BP-9 benchmark: feldolgozási idő / hanghossz); hiányzó = ismeretlen */
  rtf?: number;
}

/** az anyag-hossz → méret-osztály a routinghoz */
export function sizeForDuration(durationSec: number): SizeHint {
  if (durationSec <= 60) {
    return 'small';
  }
  return durationSec <= 10 * 60 ? 'medium' : 'large';
}

/**
 * Az átirat sorrendje: `device-first` (eszköz, aztán worker tartalékként) vagy
 * `server-first` (worker, aztán eszköz). A `routeAiTask` döntésére épül, plusz a
 * BP-9 mérés: ha a becsült eszköz-idő (rtf × hossz) túl hosszú, és van hálózat,
 * a worker megy elsőnek. Offline mindig az eszköz (ha van modell). Tiszta.
 */
export function transcriptionRoute(input: TranscriptionRouteInput): 'device-first' | 'server-first' {
  const network = input.network ?? 'online';
  if (!input.deviceModel) {
    return 'server-first';
  }
  if (network === 'offline') {
    return 'device-first';
  }
  if (typeof input.rtf === 'number' && input.rtf > 0 && input.rtf * input.durationSec > MAX_DEVICE_TRANSCRIBE_SEC) {
    return 'server-first';
  }
  const decision = routeAiTask({
    modality: 'transcribe',
    size: sizeForDuration(input.durationSec),
    network,
    tier: input.tier,
    device: { modalities: ['transcribe'] },
  });
  // a hibrid is eszköz-elő-passzal indul (a kvóta-spórolás miatt)
  return decision.target === 'server' ? 'server-first' : 'device-first';
}
