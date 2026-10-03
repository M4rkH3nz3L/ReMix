import { registerGlobals } from '@livekit/react-native';

import { cloudBaseUrl } from '@/lib/backend';
import { workerJsonHeaders } from '@/lib/workerAuth';

/**
 * 🔴 LiveKit (élő videó) kliens-híd. A WebRTC-globálisokat egyszer regisztráljuk
 * (natív modul kell → a dev-client REBUILD után él); a szerep-tokent a worker
 * `/live/token`-je mintázza (host = publish, néző = subscribe).
 */

let registered = false;
/** A WebRTC globálisok regisztrálása (idempotens, guardolt — rebuild előtt no-op). */
export function ensureLiveKit(): void {
  if (registered) {
    return;
  }
  try {
    registerGlobals();
    registered = true;
  } catch {
    // a natív @livekit/react-native-webrtc modul még nincs a buildben (rebuild előtt)
  }
}

export interface LiveToken {
  token: string;
  url: string;
}

/**
 * Szerep-token a worker `/live/token`-jéről. `publish=true` a hostnak.
 * A `userId` csak a lokális `ALLOW_INSECURE_DEV` fallbackhez kell (ott a worker
 * nem tudja a prod-tokent verifikálni); prod-ban a verifikált tokenből jön a hívó.
 */
export async function fetchLiveToken(
  room: string,
  publish: boolean,
  name: string,
  userId?: string | null
): Promise<LiveToken> {
  const base = cloudBaseUrl();
  const res = await fetch(`${base}/live/token`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ room, publish, name, userId: userId ?? undefined }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `LiveKit token-hiba (${res.status})`);
  }
  const data = (await res.json()) as Partial<LiveToken>;
  if (!data.token || !data.url) {
    throw new Error('Hiányos LiveKit token-válasz.');
  }
  return { token: data.token, url: data.url };
}
