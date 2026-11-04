import { cloudBaseUrl } from '@/lib/backend';
import { refreshEntitlement } from '@/lib/billing';
import type { Tier } from '@/lib/tiers';
import { logCaught } from '@/lib/logCaught';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { useEntitlement } from '@/store/entitlementStore';
import { useWalletEvents } from '@/store/walletEvents';

/**
 * 🧪 DEV-admin a PRO-CASH teszteléséhez — csak `__DEV__` buildben látszik, és a worker is csak
 * `ALLOW_DEV_BILLING=1` mellett engedi (élesben 403). Mindig a bejelentkezett user SAJÁT fiókjára.
 */
export type DevCoinBucket = 'purchased' | 'bonus' | 'earned' | 'earned_available';

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${cloudBaseUrl()}${path}`, { method: 'POST', headers: await workerJsonHeaders(), body: JSON.stringify(body) });
  const data = (await res.json().catch((caught) => { logCaught('lib/devBilling.ts:post', caught); return {}; })) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error || `dev_failed (${res.status})`));
  }
  return data;
}

async function after(): Promise<void> {
  await refreshEntitlement();
  useWalletEvents.getState().bump();
}

/** Szint beállítása (Free … Vállalati); `coinBilled`: Coinból fizetettként (a megújítás / add-on próbájához). */
export async function devSetTier(tier: Tier, opts: { days?: number; seats?: number; coinBilled?: boolean } = {}): Promise<void> {
  // a régi kliens-oldali „dev Pro” felülírás ne takarja el a beállított szintet
  useEntitlement.getState().setDevPro(false);
  await post('/dev/billing/tier', { tier, ...opts });
  await after();
}

export async function devGrantCoins(coins: number, bucket: DevCoinBucket = 'purchased'): Promise<void> {
  await post('/dev/coins', { coins, bucket });
  await after();
}

export async function devSetKyc(status: 'none' | 'pending' | 'verified' | 'rejected'): Promise<void> {
  await post('/dev/kyc', { status });
  await after();
}

/** `expire_now`: a periódus most lejár → megújítás Coinból vagy visszaesés · `release`: a tartás most letelik. */
export async function devCycle(action: 'expire_now' | 'release'): Promise<Record<string, unknown>> {
  const out = await post('/dev/cycle', { action });
  await after();
  return out;
}

export async function devResetWallet(): Promise<void> {
  await post('/dev/wallet/reset', {});
  await after();
}
