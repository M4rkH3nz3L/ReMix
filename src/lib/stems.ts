import { ensureCloud } from '@/lib/backend';
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';

/**
 * 🎚️ Stem-szeparáció (AI audio, Phase D) — a hangot komponensekre bontja a worker
 * (Demucs): vocals / drums / bass / other. NEHÉZ AI → felhő-worker, Pro
 * (`ensureCloud('cloudRender')` a Pro-kapu). A stemek publikus URL-ekként jönnek
 * vissza; a hívó ÚJ hangklipeket rak belőlük a sávokra (non-destruktív).
 *
 * A worker Demucs nélkül 503-at ad (env-kapuzva) — a hívó ezt kezeli.
 */
export interface Stem {
  name: string;
  url: string;
}

export async function separateStems(uri: string): Promise<Stem[]> {
  const base = ensureCloud('cloudRender'); // felhő AI-audio → Pro-kapu
  const form = await mediaFormData(uri, 'audio', { kind: 'stems' });
  const res = await uploadFetch(`${base}/audio/stems`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as { stems?: Stem[]; error?: string };
  if (!res.ok) {
    throw new Error(body.error || 'stems_failed');
  }
  return body.stems ?? [];
}
