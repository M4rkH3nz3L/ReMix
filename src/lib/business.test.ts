import {
  addClient,
  addDoc,
  clientRevenue,
  docTotal,
  docsByClient,
  emptyCrm,
  outstanding,
  overdueDocs,
  removeClient,
  revenue,
  setDocStatus,
  subtotal,
  taxAmount,
  type CRM,
  type LineItem,
} from '@/lib/business';

const T0 = '2026-01-01T00:00:00.000Z';
const items: LineItem[] = [
  { description: 'Vágás', quantity: 2, unitPrice: 50000 },
  { description: 'Színkorrekció', quantity: 1, unitPrice: 30000 },
];

const seed = (): { crm: CRM; clientId: string } => {
  let crm = addClient(emptyCrm(), { name: 'Márk', email: 'm@x.hu' }, T0);
  const clientId = crm.clients[0].id;
  return { crm, clientId };
};

describe('business — pénzügy', () => {
  const doc = { id: 'd', kind: 'invoice' as const, clientId: 'c', number: 'INV-1', items, taxRate: 0.27, status: 'draft' as const, issuedAt: T0, createdAt: T0, updatedAt: T0 };
  it('subtotal / taxAmount / docTotal', () => {
    expect(subtotal(doc)).toBe(130000); // 2*50000 + 30000
    expect(taxAmount(doc)).toBe(35100); // 130000 * 0.27
    expect(docTotal(doc)).toBe(165100);
  });
});

describe('business — ügyfelek', () => {
  it('addClient + removeClient (a dokumentumaival)', () => {
    let { crm, clientId } = seed();
    crm = addDoc(crm, { kind: 'invoice', clientId, number: 'INV-1', items, issuedAt: T0 }, T0);
    expect(docsByClient(crm, clientId)).toHaveLength(1);
    crm = removeClient(crm, clientId);
    expect(crm.clients).toHaveLength(0);
    expect(crm.docs).toHaveLength(0);
  });
  it('üres név → no-op', () => {
    const crm = emptyCrm();
    expect(addClient(crm, { name: '  ' }, T0)).toBe(crm);
  });
});

describe('business — bevétel / kintlévőség', () => {
  it('revenue csak a kifizetett számlákból; outstanding a kiküldöttekből', () => {
    let { crm, clientId } = seed();
    crm = addDoc(crm, { kind: 'invoice', clientId, number: 'INV-1', items, taxRate: 0, issuedAt: T0 }, T0);
    crm = addDoc(crm, { kind: 'invoice', clientId, number: 'INV-2', items: [{ description: 'x', quantity: 1, unitPrice: 10000 }], taxRate: 0, issuedAt: T0 }, T0);
    const [d1, d2] = crm.docs.map((d) => d.id);
    crm = setDocStatus(crm, d1, 'paid', T0);
    crm = setDocStatus(crm, d2, 'sent', T0);
    expect(revenue(crm)).toBe(130000);
    expect(outstanding(crm)).toBe(10000);
    expect(clientRevenue(crm, clientId)).toBe(130000);
  });

  it('árajánlat (quote) nem számít bevételnek', () => {
    let { crm, clientId } = seed();
    crm = addDoc(crm, { kind: 'quote', clientId, number: 'Q-1', items, taxRate: 0, issuedAt: T0 }, T0);
    crm = setDocStatus(crm, crm.docs[0].id, 'accepted', T0);
    expect(revenue(crm)).toBe(0);
  });

  it('overdueDocs: kiküldött + lejárt határidő', () => {
    let { crm, clientId } = seed();
    crm = addDoc(crm, { kind: 'invoice', clientId, number: 'INV-1', items, issuedAt: T0, dueAt: '2026-02-01T00:00:00.000Z' }, T0);
    crm = setDocStatus(crm, crm.docs[0].id, 'sent', T0);
    expect(overdueDocs(crm, '2026-03-01T00:00:00.000Z')).toHaveLength(1);
    expect(overdueDocs(crm, '2026-01-15T00:00:00.000Z')).toHaveLength(0);
  });
});
