import { File, Paths } from 'expo-file-system';

import { cloudBaseUrl } from '@/lib/backend';
import { currentUserId } from '@/lib/collab';
import type { ProgressUpdate } from '@/lib/progress';
import { exportRpFile, restoreMissingFromRpUri, type RpRestoreOutcome } from '@/lib/rpFile';
import { supabase } from '@/lib/supabase';
import { uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import type { Project } from '@/types/project';

/**
 * 📲 Átviteli tár kliens — eszköz→eszköz projekt-továbbítás felhő-előfizetés
 * nélkül: az A eszköz a teljes `.rp` csomagot a worker TRANZIENS (24 órás TTL-ű,
 * kvótán kívüli) átviteli tárába tölti, a B eszköz onnan húzza le és PONT a
 * hiányzó fájlokat köti vissza (`restoreMissingFromRpUri`). Nem tárhely-termék:
 * projektenként egy csomag, a következő feltöltés/letöltés utáni törlés söpri.
 */

export const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;

export interface TransferMeta {
  url: string;
  sizeBytes: number;
  createdAt: string;
  expired: boolean;
}

/** 📤 A projekt becsomagolása + feltöltés az átviteli tárba. */
export async function uploadProjectTransfer(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void,
): Promise<{ sizeBytes: number; expiresAt: string }> {
  const file = await exportRpFile(project, onProgress);
  const form = new FormData();
  form.append('projectId', project.id);
  // RN FormData fájl-objektum (uri+name+type) — mint a média-feltöltésnél
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: 'application/zip',
  } as unknown as Blob);
  const res = await uploadFetch(`${cloudBaseUrl()}/transfer`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Átvitel sikertelen (${res.status}).`);
  }
  const body = (await res.json()) as { sizeBytes?: number; expiresAt?: string };
  return { sizeBytes: body.sizeBytes ?? 0, expiresAt: body.expiresAt ?? '' };
}

/** A projekt átviteli csomagjának metája (RLS: a sajátom), vagy null. */
export async function fetchProjectTransfer(projectId: string): Promise<TransferMeta | null> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return null;
  }
  try {
    const { data } = await supabase
      .from('project_transfers')
      .select('url, size_bytes, created_at')
      .eq('user_id', uid)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!data?.url) {
      return null;
    }
    const createdAt = String(data.created_at ?? '');
    const t = Date.parse(createdAt);
    return {
      url: data.url as string,
      sizeBytes: Number(data.size_bytes ?? 0),
      createdAt,
      expired: !Number.isFinite(t) || Date.now() - t > TRANSFER_TTL_MS,
    };
  } catch {
    return null;
  }
}

/** 🗑️ a csomag törlése (sikeres átvétel után — a tár tranziens marad). */
export async function deleteProjectTransfer(projectId: string): Promise<void> {
  try {
    await uploadFetch(`${cloudBaseUrl()}/transfer/${projectId}`, {
      method: 'DELETE',
      headers: await workerAuthHeaders(),
    });
  } catch {
    // best-effort — a lazy TTL amúgy is söpri
  }
}

/**
 * 📥 B eszköz: a csomag letöltése + PONT a hiányzók visszakötése. A relink-párok
 * átvitele a hívó dolga (command-bus). Siker után a csomag törlődik a tárból.
 */
export async function restoreProjectFromTransfer(
  project: Project,
): Promise<RpRestoreOutcome | null> {
  const meta = await fetchProjectTransfer(project.id);
  if (!meta || meta.expired) {
    return null;
  }
  const target = new File(Paths.cache, `transfer_${Date.now().toString(36)}.rp`);
  await File.downloadFileAsync(meta.url, target);
  if ((target.size ?? 0) === 0) {
    return null;
  }
  const outcome = restoreMissingFromRpUri(project, target.uri);
  try {
    target.delete();
  } catch {
    // cache-takarítás best-effort
  }
  if (outcome.matched > 0) {
    void deleteProjectTransfer(project.id);
  }
  return outcome;
}
