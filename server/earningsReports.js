// 📊 Bevételi kimutatás és DAC7-export CSV-ben (PRO-CASH C3.5) — tiszta CSV-építők.
// Pontosvesszős, UTF-8 BOM-mal (a magyar Excel így nyitja jól), tizedesvesszővel.

const BOM = '﻿';

function cell(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function eur(cents) {
  return (Math.trunc(Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
}

function coins(cents) {
  return eur(cents); // 1 Coin = 100 cent-Coin → ugyanaz a két tizedes
}

function toCsv(rows) {
  return BOM + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const KIND_LABEL = { sale: 'Bolti eladás', gift: 'Ajándék', commission: 'Remix-jutalék', referral: 'Ajánlói jutalék', fund: 'Alkotói alap' };

/** Az alkotó éves kimutatása (az earnings_statement_for jsonb-jéből). */
function statementCsv(st) {
  const rows = [['ReMix bevételi kimutatás', st.year], [], ['Forrás', 'Megkeresett Coin', 'Ellenérték (EUR, 3 €/Coin)']];
  for (const [kind, cents] of Object.entries(st.by_kind || {})) {
    rows.push([KIND_LABEL[kind] || kind, coins(cents), eur(Number(cents) * 3)]);
  }
  rows.push(['Összesen', coins(st.earned_cents), eur(Number(st.earned_cents) * 3)]);
  rows.push(['Tételek száma', st.transactions]);
  rows.push([]);
  rows.push(['Kifizetés dátuma', 'Összeg (EUR)', 'Partner']);
  for (const p of st.payouts || []) {
    rows.push([p.date, eur(p.eur_cents), p.provider || '']);
  }
  rows.push(['Kifizetve összesen', eur(st.paid_out_eur_cents)]);
  return toCsv(rows);
}

/** DAC7-export (a dac7_report soraiból): eladónként negyedéves ellenérték és darabszám. */
function dac7Csv(year, rows) {
  const out = [[
    'Év', 'Felhasználó-azonosító', 'Felhasználónév', 'Partner', 'Partner-fiók', 'KYC',
    'Q1 EUR', 'Q2 EUR', 'Q3 EUR', 'Q4 EUR', 'Q1 db', 'Q2 db', 'Q3 db', 'Q4 db', 'Összesen EUR', 'Összesen db', 'Jelentendő',
  ]];
  for (const r of rows || []) {
    out.push([
      year, r.user_id, r.username || '', r.provider || '', r.account_ref || '', r.kyc_status,
      eur(r.q1_eur_cents), eur(r.q2_eur_cents), eur(r.q3_eur_cents), eur(r.q4_eur_cents),
      r.q1_tx, r.q2_tx, r.q3_tx, r.q4_tx, eur(r.total_eur_cents), r.total_tx, r.reportable ? 'igen' : 'nem',
    ]);
  }
  return toCsv(out);
}

module.exports = { statementCsv, dac7Csv, toCsv, eur };
