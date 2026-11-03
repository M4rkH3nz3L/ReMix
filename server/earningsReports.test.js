// 📊 C3.5 CSV-építők: magyar Excel-barát formátum, helyes összegek, idézőjelezés.
const { statementCsv, dac7Csv, toCsv } = require('./earningsReports');

test('éves kimutatás: forrásonként Coin és euró, kifizetések', () => {
  const csv = statementCsv({
    year: 2026, by_kind: { sale: 3100, gift: 200 }, earned_cents: 3300, transactions: 32,
    paid_out_eur_cents: 6000, payouts: [{ date: '2026-11-04', eur_cents: 6000, provider: 'stripe' }],
  });
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv).toContain('Bolti eladás;31,00;93,00');
  expect(csv).toContain('Összesen;33,00;99,00');
  expect(csv).toContain('2026-11-04;60,00;stripe');
});

test('DAC7: negyedéves sorok, jelentendő jelzővel', () => {
  const csv = dac7Csv(2026, [{
    user_id: 'u1', username: 'a;b', provider: 'stripe', account_ref: 'acct_1', kyc_status: 'verified',
    q1_eur_cents: 0, q2_eur_cents: 0, q3_eur_cents: 0, q4_eur_cents: 9900, q1_tx: 0, q2_tx: 0, q3_tx: 0, q4_tx: 32,
    total_eur_cents: 9900, total_tx: 32, reportable: true,
  }]);
  const line = csv.split('\r\n')[1];
  expect(line).toBe('2026;u1;"a;b";stripe;acct_1;verified;0,00;0,00;0,00;99,00;0;0;0;32;99,00;32;igen');
});

test('idézőjel a cellában duplázva', () => {
  expect(toCsv([['say "hi"']])).toBe('﻿"say ""hi"""\r\n');
});
