// 🏢 Cégellenőrzés (C4.2) — VIES mockkal, domain-szabályok.
const { checkVies, checkDomain, vatNumberPart, verifyCompany } = require('./companyVerify');

const vies = (body, ok = true, status = 200) => jest.fn(async () => ({ ok, status, json: async () => body }));

test('VIES: érvényes adószám a cégnévvel; az országkód lecsupaszítva, Görögország EL', async () => {
  const f = vies({ isValid: true, name: 'TESZT KFT', address: 'BUDAPEST' });
  await expect(checkVies('HU', 'HU 1234-5678', f)).resolves.toMatchObject({ valid: true, name: 'TESZT KFT' });
  expect(f.mock.calls[0][0]).toBe('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/HU/vat/12345678');
  const g = vies({ isValid: false });
  await checkVies('GR', 'EL999', g);
  expect(g.mock.calls[0][0]).toMatch(/\/ms\/EL\/vat\/999$/);
  expect(vatNumberPart('DE', 'de 123 456 789')).toBe('123456789');
});

test('VIES: érvénytelen / nem EU / elérhetetlen', async () => {
  await expect(checkVies('HU', 'HU1', vies({ isValid: false }))).resolves.toMatchObject({ valid: false });
  await expect(checkVies('US', '123', vies({}))).resolves.toEqual({ valid: false, reason: 'not_eu_or_missing' });
  await expect(checkVies('HU', 'HU1', vies({ userError: 'MS_UNAVAILABLE' }, false, 503))).resolves.toEqual({ valid: null, error: 'MS_UNAVAILABLE' });
  await expect(checkVies('HU', 'HU1', async () => { throw new Error('net'); })).resolves.toEqual({ valid: null, error: 'vies_unreachable' });
});

test('domain: céges domain igen, ingyenes levelező vagy eltérő domain nem', () => {
  expect(checkDomain('szamla@teszt.hu', 'teszt.hu').ok).toBe(true);
  expect(checkDomain('szamla@gmail.com', 'gmail.com')).toMatchObject({ ok: false, freeMail: true });
  expect(checkDomain('valaki@mas.hu', 'teszt.hu').ok).toBe(false);
});

test('verifyCompany: mindkét eredményt összegyűjti', async () => {
  const r = await verifyCompany({ country: 'HU', vat_id: 'HU12345678', billing_email: 'a@teszt.hu', domain: 'teszt.hu' }, vies({ isValid: true, name: 'X' }));
  expect(r).toMatchObject({ eu: true, vies: { valid: true }, domain: { ok: true } });
});
