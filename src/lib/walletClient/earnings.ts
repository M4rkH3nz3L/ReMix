import { cloudBaseUrl } from '@/lib/backend';
import { groupEarnings, type EarningsMonth } from '@/lib/coins';
import { shareFile } from '@/lib/export';
import { supabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { currentUid } from '@/lib/walletClient/session';

export async function fetchEarnings(months = 6): Promise<EarningsMonth[]> {
  if (!supabase || !currentUid()) {
    return [];
  }
  const { data, error } = await supabase.rpc('my_earnings', { p_months: months });
  if (error) {
    throw new Error(error.message);
  }
  return groupEarnings(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    month: String(r.month),
    kind: String(r.kind),
    cents: Number(r.cents ?? 0),
  })));
}

/** Az éves bevételi kimutatás (CSV) letöltése / megosztása — az adóbevalláshoz. */
export async function downloadEarningsStatement(year: number): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/wallet/statement?year=${year}`, { headers: await workerJsonHeaders() });
  if (!res.ok) {
    throw new Error(`statement_failed (${res.status})`);
  }
  await shareFile(`remix-bevetel-${year}.csv`, await res.text(), 'text/csv');
}

/** DAC7-export (CSV) — `finance.manage` jogú adminnak (a szerver ellenőrzi). */
export async function downloadDac7(year: number): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/admin/dac7?year=${year}`, { headers: await workerJsonHeaders() });
  if (!res.ok) {
    throw new Error(res.status === 403 ? 'forbidden' : `dac7_failed (${res.status})`);
  }
  await shareFile(`remix-dac7-${year}.csv`, await res.text(), 'text/csv');
}
