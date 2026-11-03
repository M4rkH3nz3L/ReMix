// 🧾 Céges számla (C4.4): ÁFA-kezelés vevőnként, összegek, határidő, HTML-kép.
const { buildInvoice, renderInvoiceHtml, vatTreatment } = require('./invoice');

const seller = { name: 'ReMix Kft.', address: 'Budapest', vatId: 'HU00000000' };
const line = [{ description: 'ReMix Vállalati — 5 fő, 2026-11', qty: 5, unitNetCents: 5000 }];
const base = { number: 'RMX-2026-000001', issueDate: '2026-11-04', seller, lines: line };

test('magyar cég: 27% ÁFA', () => {
  const inv = buildInvoice({ ...base, buyer: { name: 'Teszt Kft.', country: 'HU', vatId: 'HU12345678', vatValid: true } });
  expect(inv.totals).toEqual({ netCents: 25000, vatCents: 6750, grossCents: 31750 });
  expect(inv.vat.code).toBe('HU_DOMESTIC');
});

test('EU-s cég érvényes adószámmal: fordított adózás, 0%, a számlán a szöveggel', () => {
  const inv = buildInvoice({ ...base, buyer: { name: 'Test GmbH', country: 'DE', vatId: 'DE123456789', vatValid: true } });
  expect(inv.totals).toEqual({ netCents: 25000, vatCents: 0, grossCents: 25000 });
  expect(renderInvoiceHtml(inv)).toContain('Fordított adózás');
});

test('EU-s cég nem igazolt adószámmal: 27%; EU-n kívül: hatályon kívül', () => {
  expect(vatTreatment({ country: 'DE', vatId: 'DE1', vatValid: false }).pct).toBe(27);
  expect(vatTreatment({ country: 'US' })).toMatchObject({ pct: 0, code: 'OUTSIDE_EU' });
});

test('átutalás: nettó 15 nap; Coinból: azonnal', () => {
  const buyer = { name: 'Teszt Kft.', country: 'HU' };
  expect(buildInvoice({ ...base, buyer }).dueDate).toBe('2026-11-19');
  expect(buildInvoice({ ...base, buyer, method: 'coins' }).dueDate).toBe('2026-11-04');
});

test('a HTML kiszűri a beinjektált jelölőket', () => {
  const inv = buildInvoice({ ...base, buyer: { name: '<script>x</script>', country: 'HU' } });
  expect(renderInvoiceHtml(inv)).not.toContain('<script>x');
});
