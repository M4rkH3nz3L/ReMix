import { cloudBaseUrl } from '@/lib/backend';
import { refreshEntitlement } from '@/lib/billing';
import { shareFile } from '@/lib/export';
import { logCaught } from '@/lib/logCaught';
import { requireSupabase, supabase } from '@/lib/supabase';
import { workerJsonHeaders } from '@/lib/workerAuth';

/**
 * 🏢 Vállalati szervezet kliens-réteg (PRO-CASH 5., C4.1–C4.5). Minden írás SECURITY DEFINER
 * RPC-n megy (a szerepkört a DB dönti el); a cégellenőrzés és a számla a workeren.
 */

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrgMember {
  userId: string;
  username: string | null;
  role: OrgRole;
  storageLimitGb: number | null;
  aiTokensLimit: number | null;
  renderMinutesLimit: number | null;
}

export interface MyOrg {
  id: string;
  name: string;
  country: string;
  vatId: string | null;
  status: 'pending' | 'verified' | 'rejected' | 'suspended';
  vies: boolean | null;
  domainOk: boolean | null;
  myRole: OrgRole;
  seats: number;
  pendingSeats: number | null;
  seatPriceCents: number;
  active: boolean;
  until: string | null;
  members: OrgMember[];
  storageUsedBytes: number;
  storageQuotaBytes: number;
}

export function parseOrg(raw: unknown): MyOrg | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const ver = (r.verification ?? {}) as { vies?: { valid?: boolean | null }; domain?: { ok?: boolean } };
  const st = (r.storage ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    country: String(r.country ?? ''),
    vatId: (r.vat_id as string | null) ?? null,
    status: (r.status as MyOrg['status']) ?? 'pending',
    vies: ver.vies ? (ver.vies.valid ?? null) : null,
    domainOk: ver.domain ? !!ver.domain.ok : null,
    myRole: (r.my_role as OrgRole) ?? 'member',
    seats: Number(r.seats ?? 2),
    pendingSeats: r.pending_seats == null ? null : Number(r.pending_seats),
    seatPriceCents: Number(r.seat_price_cents ?? 1000),
    active: r.active === true,
    until: (r.until as string | null) ?? null,
    members: ((r.members ?? []) as Record<string, unknown>[]).map((m) => ({
      userId: String(m.user_id),
      username: (m.username as string | null) ?? null,
      role: (m.role as OrgRole) ?? 'member',
      storageLimitGb: m.storage_limit_gb == null ? null : Number(m.storage_limit_gb),
      aiTokensLimit: m.ai_tokens_limit == null ? null : Number(m.ai_tokens_limit),
      renderMinutesLimit: m.render_minutes_limit == null ? null : Number(m.render_minutes_limit),
    })),
    storageUsedBytes: Number(st.used_bytes ?? 0),
    storageQuotaBytes: Number(st.quota_bytes ?? 0),
  };
}

export async function fetchMyOrg(): Promise<MyOrg | null> {
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.rpc('my_org');
  if (error) {
    throw new Error(error.message);
  }
  return parseOrg(data);
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await requireSupabase().rpc(name, args);
  if (error) {
    throw new Error(
      /already_in_org|forbidden|user_not_found|no_free_seat|seats_below_members|org_not_verified|invalid seats|insufficient_credits|cannot_remove_owner|use_org_set_seats|managed_by_store/.exec(error.message)?.[0] ??
        error.message
    );
  }
  return data;
}

export async function createOrganization(input: {
  name: string; country: string; vatId?: string; regNumber?: string; domain?: string; billingEmail?: string; billingAddress?: string;
}): Promise<string> {
  return String(await rpc('create_organization', {
    p_name: input.name, p_country: input.country, p_vat_id: input.vatId ?? null, p_reg_number: input.regNumber ?? null,
    p_domain: input.domain ?? null, p_billing_email: input.billingEmail ?? null, p_billing_address: input.billingAddress ?? null,
  }));
}

export const addMember = (org: string, username: string, role: 'admin' | 'member' = 'member') =>
  rpc('org_add_member', { p_org: org, p_username: username.trim().replace(/^@/, ''), p_role: role });
export const removeMember = (org: string, userId: string) => rpc('org_remove_member', { p_org: org, p_user: userId });
export const setMemberLimits = (org: string, userId: string, storageGb: number | null, aiTokens: number | null, renderMinutes: number | null) =>
  rpc('org_set_member_limits', { p_org: org, p_user: userId, p_storage_gb: storageGb, p_ai_tokens: aiTokens, p_render_minutes: renderMinutes });
export const setSeats = (org: string, seats: number) => rpc('org_set_seats', { p_org: org, p_seats: seats });

export async function subscribeOrgWithCoins(org: string, months: 1 | 12, seats: number): Promise<void> {
  await rpc('org_subscribe_with_coins', { p_org: org, p_months: months, p_seats: seats });
  await refreshEntitlement().catch((caught) => { logCaught('lib/org.ts:subscribeOrgWithCoins', caught); });
}

async function worker(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${cloudBaseUrl()}${path}`, { ...init, headers: { ...(await workerJsonHeaders()), ...(init?.headers ?? {}) } });
}

/** Cégellenőrzés (VIES + céges domain) — az eredmény a jóváhagyás alapja. */
export async function verifyOrg(): Promise<{ vies: { valid: boolean | null }; domain: { ok: boolean } }> {
  const res = await worker('/org/verify', { method: 'POST', body: '{}' });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'verify_failed');
  }
  return body;
}

/** Átutalásos számla kérése (nettó 15 nap). */
export async function requestInvoice(months: 1 | 12, seats: number): Promise<{ id: string; number: string; grossCents: number }> {
  const res = await worker('/org/invoice', { method: 'POST', body: JSON.stringify({ months, seats }) });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'invoice_failed');
  }
  return { id: String(body.id), number: String(body.number), grossCents: Number(body.gross_cents ?? 0) };
}

export interface OrgInvoice {
  id: string;
  number: string;
  grossCents: number;
  status: 'open' | 'paid' | 'void';
  dueAt: string;
}

export async function listInvoices(): Promise<OrgInvoice[]> {
  if (!supabase) {
    return [];
  }
  const { data } = await supabase.from('invoices').select('id, number, gross_cents, status, due_at').order('issued_at', { ascending: false }).limit(24);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), number: String(r.number), grossCents: Number(r.gross_cents ?? 0), status: r.status as OrgInvoice['status'], dueAt: String(r.due_at ?? ''),
  }));
}

/** A számla nyomtatható képe (HTML) — megosztás / mentés, a böngészőből PDF-be nyomtatható. */
export async function downloadInvoice(inv: OrgInvoice): Promise<void> {
  const res = await worker(`/org/invoice/${inv.id}`);
  if (!res.ok) {
    throw new Error(`invoice_failed (${res.status})`);
  }
  await shareFile(`${inv.number}.html`, await res.text(), 'text/html');
}

/** Jóváhagyásra váró szervezet (pénzügyi admin, `finance.manage`). */
export interface PendingOrg {
  id: string;
  name: string;
  country: string;
  vatId: string | null;
  regNumber: string | null;
  vies: boolean | null;
  domainOk: boolean | null;
}

export async function listPendingOrgs(): Promise<PendingOrg[]> {
  const data = (await rpc('orgs_pending_review', {})) as Record<string, unknown>[] | null;
  return (data ?? []).map((r) => {
    const v = (r.verification ?? {}) as { vies?: { valid?: boolean | null }; domain?: { ok?: boolean } };
    return {
      id: String(r.id), name: String(r.name), country: String(r.country), vatId: (r.vat_id as string | null) ?? null,
      regNumber: (r.reg_number as string | null) ?? null, vies: v.vies ? (v.vies.valid ?? null) : null, domainOk: v.domain ? !!v.domain.ok : null,
    };
  });
}

export const reviewOrg = (id: string, approve: boolean) => rpc('admin_review_org', { p_org: id, p_approve: approve, p_seat_price_cents: null });

export interface OpenInvoice {
  id: string;
  number: string;
  orgName: string;
  grossCents: number;
  dueAt: string;
}

export async function listOpenInvoices(): Promise<OpenInvoice[]> {
  const data = (await rpc('invoices_open', {})) as Record<string, unknown>[] | null;
  return (data ?? []).map((r) => ({ id: String(r.id), number: String(r.number), orgName: String(r.org_name), grossCents: Number(r.gross_cents ?? 0), dueAt: String(r.due_at) }));
}

export const markInvoicePaid = (id: string) => rpc('invoice_mark_paid', { p_invoice: id });
