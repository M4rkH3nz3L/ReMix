// ⬆️ Médiafeltöltés a worker /media/upload végpontjára.
import { t as tr } from 'i18next';

import { cloudBaseUrl } from '@/lib/backend';
import { readJson } from '@/lib/netRetry';
import { StorageQuotaError } from '@/lib/storageQuota';
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { logCaught } from '@/lib/logCaught';

/** Média-típus = mappanév a projekten belül a Storage-ban. */
export type MediaKind = 'video' | 'poster' | 'media' | 'profile' | 'image';

/** Feltöltési cél: projekt-rendezett Storage-kulcs (`<projectId>/<kind>/<fájl>`). */
export interface UploadTarget {
  /** ha projekthez tartozik → a kulcs `<projectId>/<kind>/…` lesz */
  projectId?: string;
  /** média-típus (mappanév); alap: `media` */
  kind?: MediaKind;
  /** eredeti fájlnév (a kiterjesztéshez) */
  name?: string;
}

/**
 * Egy helyi médiafájl (renderelt videó / borító / asset) feltöltése → a publikus
 * URL (feed / cross-device lejátszáshoz). A fájl a projekt mappájába kerül:
 * `<projectId>/<kind>/<fájl>`.
 *
 * MINDEN platform a worker `/media/upload`-ját használja: a SZERVER tölt (dev-ben
 * a böngészhető `server/media` mappába, prodon service_role Supabase Storage-ba) →
 * NINCS kliens-oldali Storage-RLS (az dobta a „new row violates row-level security
 * policy"-t), és a fájl ott van a szerver mappájában. Weben az `uri` (blob:/http)
 * blobként megy fel (`mediaFormData` intézi).
 */
export async function uploadMedia(uri: string, target?: UploadTarget): Promise<string> {
  return (await uploadMediaResult(uri, target)).url;
}

/**
 * Mint a `uploadMedia`, de a publikus URL MELLETT a fájl bájt-méretét is visszaadja
 * (a szerver a `/media/upload`-nál méri) — a média-szinkron ebből tölti az
 * `asset.size`-t. Ha a MI tárhely-kvótánk betelne, a szerver 507-et ad → itt
 * `StorageQuotaError`-t dobunk (a UI a bővítésre/törlésre irányít).
 */
export async function uploadMediaResult(
  uri: string,
  target?: UploadTarget
): Promise<{ url: string; size: number }> {
  const base = cloudBaseUrl();
  const form = await mediaFormData(uri, target?.name, {
    ...(target?.projectId ? { projectId: target.projectId } : {}),
    kind: target?.kind ?? 'media',
  });
  const res = await uploadFetch(`${base}/media/upload`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  if (res.status === 507) {
    throw new StorageQuotaError();
  }
  if (!res.ok) {
    const msg = await res.text().catch((caught) => { logCaught('lib/render.ts:uploadMediaResult', caught); return ''; });
    throw new Error(msg || tr('lib.render.uploadFailed'));
  }
  const data = await readJson<{ url?: string; size?: number }>(res, tr('lib.render.uploadFailed'));
  if (!data.url) {
    throw new Error(tr('lib.render.uploadFailed'));
  }
  return { url: data.url, size: Number(data.size ?? 0) };
}
