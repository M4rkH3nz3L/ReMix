import { InsufficientCreditsError } from '@/lib/shop';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🗄️ Tárhely-kvóta kliens-réteg — a MI tárhelyünkön (Supabase `renders` bucket /
 * szerver-média) fekvő bájtok elszámolása és a koinos HAVI bővítés.
 *
 * A használat/kvóta SZERVER-HITELES: a `storage_usage` / `buy_storage_boost` /
 * `record_storage_object` SECURITY DEFINER RPC-ken megy (lásd a 20260927130000-
 * migrációt). Az alap fix: ingyenes 1 GiB / Pro 5 GiB (a subscriptions tier-ből);
 * a bónusz koinnal vehető (100 koin / GB / hó). A user SAJÁT Drive/Dropbox/WebDAV/
 * S3 forrásán fekvő média NEM számít bele (lásd `@/lib/externalStorage`).
 */

/** 1 hónapnyi 1 GB-os bővítés ára koinban. */
export const STORAGE_COIN_PER_GB_MONTH = 100;

export interface StorageUsage {
  usedBytes: number;
  baseBytes: number;
  bonusBytes: number;
  quotaBytes: number;
  bonusExpiresAt: string | null;
}

function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}

function mapUsage(j: unknown): StorageUsage {
  const o = (j ?? {}) as Record<string, unknown>;
  return {
    usedBytes: Number(o.used_bytes ?? 0),
    baseBytes: Number(o.base_bytes ?? 0),
    bonusBytes: Number(o.bonus_bytes ?? 0),
    quotaBytes: Number(o.quota_bytes ?? 0),
    bonusExpiresAt: (o.bonus_expires_at as string | null) ?? null,
  };
}

/** Kvóta-túllépés a MI tárhelyünkön (kemény tiltás) — a UI a bővítésre/törlésre irányít. */
export class StorageQuotaError extends Error {
  constructor() {
    super('quota_exceeded');
    this.name = 'StorageQuotaError';
  }
}

/** Az aktuális használatom/kvótám, vagy null (nincs backend / nincs bejelentkezve). */
export async function fetchStorageUsage(): Promise<StorageUsage | null> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return null;
  }
  const { data, error } = await supabase.rpc('storage_usage');
  if (error) {
    throw new Error(error.message);
  }
  return mapUsage(data);
}

/**
 * Koinos HAVI tárhely-bővítés (atomikus RPC). `gb` × `months` × 100 koin. Kevés
 * kredit → InsufficientCreditsError (a UI a kredit-vásárlásra irányít).
 */
export async function buyStorageBoost(
  gb: number,
  months: number
): Promise<{ balance: number; cost: number; usage: StorageUsage }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('buy_storage_boost', { p_gb: gb, p_months: months });
  if (error) {
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    balance: Number(d.balance ?? 0),
    cost: Number(d.cost ?? 0),
    usage: mapUsage(d.usage),
  };
}

/** Egy PROJEKT által a MI tárhelyünkön elfoglalt bájt (per-projekt kijelzéshez). */
export async function projectStorageBytes(projectId: string): Promise<number> {
  const uid = currentUid();
  if (!supabase || !uid || !projectId) {
    return 0;
  }
  const { data } = await supabase
    .from('storage_objects')
    .select('bytes')
    .eq('user_id', uid)
    .eq('project_id', projectId);
  return (data ?? []).reduce((sum, r) => sum + Number((r as { bytes?: number }).bytes ?? 0), 0);
}

/**
 * Webes KÖZVETLEN Supabase-feltöltés után a fájl felvétele a bájt-naplóba
 * (kvóta-ellenőrzéssel; a valódi méretet a szerver a storage-objektumból olvassa).
 * Túllépés → StorageQuotaError.
 */
export async function recordStorageObject(
  bucket: string,
  key: string,
  projectId?: string | null
): Promise<StorageUsage> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('record_storage_object', {
    p_bucket: bucket,
    p_key: key,
    p_project_id: projectId ?? null,
  });
  if (error) {
    if (/quota_exceeded/.test(error.message)) {
      throw new StorageQuotaError();
    }
    throw new Error(error.message);
  }
  return mapUsage(data);
}

/** Az ÖSSZES projektem MI-tárhely-használata egyetlen lekérdezésből (projectId→bájt). */
export async function projectStorageMap(): Promise<Record<string, number>> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return {};
  }
  const { data } = await supabase
    .from('storage_objects')
    .select('project_id, bytes')
    .eq('user_id', uid);
  const map: Record<string, number> = {};
  for (const r of data ?? []) {
    const row = r as { project_id?: string | null; bytes?: number };
    if (!row.project_id) {
      continue;
    }
    map[row.project_id] = (map[row.project_id] ?? 0) + Number(row.bytes ?? 0);
  }
  return map;
}

/** Emberi bájt-formázás (1024-es lépcső). */
export function formatBytes(n: number): string {
  if (!n || n < 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
