import { makeId } from '@/lib/id';

/**
 * 💰 Creator Business / CRM (E-Business — MASTER §23) — az „otthon tartás" üzleti
 * rétege: ügyfelek + árajánlatok/számlák + tételek + státuszok, és a származtatott
 * pénzügy (részösszeg/adó/végösszeg, bevétel, kintlévőség). Tiszta, expo-mentes,
 * immutábilis; pénznem-agnosztikus (a hívó dönt a devizáról/kerekítésről).
 */

export interface Client {
  id: string;
  name: string;
  email?: string;
  company?: string;
  createdAt: string;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export type DocKind = 'quote' | 'invoice';
export type DocStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'paid' | 'overdue';

export interface BusinessDoc {
  id: string;
  kind: DocKind;
  clientId: string;
  /** ember-olvasható sorszám (pl. INV-2026-001) */
  number: string;
  items: LineItem[];
  /** ÁFA/adó kulcs 0–1 (0.27 = 27%) */
  taxRate: number;
  status: DocStatus;
  issuedAt: string;
  /** fizetési határidő (számlánál) */
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CRM {
  clients: Client[];
  docs: BusinessDoc[];
}

export function emptyCrm(): CRM {
  return { clients: [], docs: [] };
}

const money = (n: number): number => Math.round(n * 100) / 100;

// ── Pénzügy (származtatott) ───────────────────────────────────────────────────

export function lineTotal(item: LineItem): number {
  return money(item.quantity * item.unitPrice);
}
export function subtotal(doc: BusinessDoc): number {
  return money(doc.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
}
export function taxAmount(doc: BusinessDoc): number {
  return money(subtotal(doc) * doc.taxRate);
}
export function docTotal(doc: BusinessDoc): number {
  return money(subtotal(doc) + taxAmount(doc));
}

// ── Ügyfelek ──────────────────────────────────────────────────────────────────

export function addClient(crm: CRM, input: { name: string; email?: string; company?: string }, now: string): CRM {
  const name = input.name.trim();
  if (!name) {
    return crm;
  }
  const client: Client = {
    id: makeId('cli'),
    name,
    ...(input.email ? { email: input.email } : {}),
    ...(input.company ? { company: input.company } : {}),
    createdAt: now,
  };
  return { ...crm, clients: [...crm.clients, client] };
}

export function removeClient(crm: CRM, id: string): CRM {
  return { clients: crm.clients.filter((c) => c.id !== id), docs: crm.docs.filter((d) => d.clientId !== id) };
}

// ── Dokumentumok (árajánlat / számla) ─────────────────────────────────────────

export function addDoc(
  crm: CRM,
  input: { kind: DocKind; clientId: string; number: string; items: LineItem[]; taxRate?: number; issuedAt: string; dueAt?: string },
  now: string
): CRM {
  const doc: BusinessDoc = {
    id: makeId('doc'),
    kind: input.kind,
    clientId: input.clientId,
    number: input.number,
    items: input.items,
    taxRate: input.taxRate ?? 0,
    status: 'draft',
    issuedAt: input.issuedAt,
    ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { ...crm, docs: [...crm.docs, doc] };
}

export function setDocStatus(crm: CRM, id: string, status: DocStatus, now: string): CRM {
  let changed = false;
  const docs = crm.docs.map((d) => {
    if (d.id !== id) {
      return d;
    }
    changed = true;
    return { ...d, status, updatedAt: now };
  });
  return changed ? { ...crm, docs } : crm;
}

export function removeDoc(crm: CRM, id: string): CRM {
  const docs = crm.docs.filter((d) => d.id !== id);
  return docs.length === crm.docs.length ? crm : { ...crm, docs };
}

// ── Lekérdezések / összesítők ──────────────────────────────────────────────────

export function docsByClient(crm: CRM, clientId: string): BusinessDoc[] {
  return crm.docs.filter((d) => d.clientId === clientId);
}

/** Bevétel = a KIFIZETETT számlák végösszegének összege. */
export function revenue(crm: CRM): number {
  return money(crm.docs.filter((d) => d.kind === 'invoice' && d.status === 'paid').reduce((s, d) => s + docTotal(d), 0));
}

/** Kintlévőség = a kiküldött/lejárt (nem fizetett) számlák végösszege. */
export function outstanding(crm: CRM): number {
  return money(
    crm.docs
      .filter((d) => d.kind === 'invoice' && (d.status === 'sent' || d.status === 'overdue'))
      .reduce((s, d) => s + docTotal(d), 0)
  );
}

/** Egy ügyfél eddigi bevétele (kifizetett számlák). */
export function clientRevenue(crm: CRM, clientId: string): number {
  return money(
    docsByClient(crm, clientId)
      .filter((d) => d.kind === 'invoice' && d.status === 'paid')
      .reduce((s, d) => s + docTotal(d), 0)
  );
}

/** Lejárt számlák: kiküldött, van határidejük és az már elmúlt (a `now`-hoz). */
export function overdueDocs(crm: CRM, now: string): BusinessDoc[] {
  return crm.docs.filter((d) => d.kind === 'invoice' && d.status === 'sent' && d.dueAt !== undefined && d.dueAt < now);
}
