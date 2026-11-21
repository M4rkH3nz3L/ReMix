import { cloudBaseUrl } from '@/lib/backend';
import { EMPTY_WALLET, parseWallet, type WalletBreakdown } from '@/lib/coins';
import { supabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { logCaught } from '@/lib/logCaught';
import type { CreditTx } from '@/lib/walletCore/types';
import { currentUid } from '@/lib/walletClient/session';

/** A pénztárcám bontása (vásárolt / bónusz / függő / beváltható). A lejárt tartást a szerver feloldja. */
export async function fetchWallet(): Promise<WalletBreakdown> {
  if (!supabase || !currentUid()) {
    return EMPTY_WALLET;
  }
  const { data, error } = await supabase.rpc('my_wallet');
  if (error) {
    throw new Error(error.message);
  }
  return parseWallet(data);
}

/** A legutóbbi kredit-tranzakcióim (napló). */
export async function creditHistory(limit = 20): Promise<CreditTx[]> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return [];
  }
  const { data } = await supabase
    .from('credit_transactions')
    .select('id, delta_cents, bucket, kind, note, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    deltaCents: Number(r.delta_cents ?? 0),
    bucket: (r.bucket as CreditTx['bucket']) ?? null,
    kind: String(r.kind ?? ''),
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }));
}

/**
 * 💶 Webes Coin-feltöltés (Stripe Checkout, 5 € / Coin, PRO-CASH C1.5): a worker Checkout
 * Sessiont nyit, a fizetett összeget a Stripe webhook írja jóvá. Visszaadja a fizetési oldal címét.
 */
export async function startWebTopup(packId: string): Promise<string> {
  const res = await fetch(`${cloudBaseUrl()}/billing/stripe/checkout`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ packId }),
  });
  const body = (await res.json().catch((caught) => { logCaught('lib/wallet.ts:startWebTopup', caught); return {}; })) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !body.url) {
    throw new Error(body.error || 'checkout_failed');
  }
  return body.url;
}
