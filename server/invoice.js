// 🧾 Céges számla (PRO-CASH C4.4, 5.2, 8.2) — tiszta számla-mag.
//
// ÁFA (könyvelővel véglegesítendő, PRO-CASH 8.2):
//   • magyar vevő → 27% ÁFA;
//   • más EU-s cég ÉRVÉNYES (VIES) közösségi adószámmal → fordított adózás, 0% (a vevő vallja be);
//   • EU-n kívüli vevő → az ÁFA hatályán kívül, 0%;
//   • EU-s vevő érvényes adószám nélkül → a magyar 27% (B2B nem igazolt).
// Az árak NETTÓK (a Coin értéke 5 € / Coin), a számla fizethető Coinból vagy átutalással (nettó
// 15 nap). Összegek euró-centben, soronként kerekítve.

const HU_VAT_PCT = 27;
const TRANSFER_DUE_DAYS = 15;

function vatTreatment(buyer) {
  const country = String(buyer.country || '').toUpperCase();
  const { isEu } = require('./companyVerify');
  if (country === 'HU') {
    return { pct: HU_VAT_PCT, code: 'HU_DOMESTIC', note: null };
  }
  if (isEu(country) && buyer.vatValid === true && buyer.vatId) {
    return { pct: 0, code: 'EU_REVERSE_CHARGE', note: 'Fordított adózás — Reverse charge (2006/112/EK irányelv 196. cikk)' };
  }
  if (!isEu(country)) {
    return { pct: 0, code: 'OUTSIDE_EU', note: 'Az ÁFA hatályán kívüli szolgáltatás — Outside the scope of EU VAT' };
  }
  return { pct: HU_VAT_PCT, code: 'EU_UNVERIFIED', note: null };
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A számla adatai. `lines`: [{ description, qty, unitNetCents }]; `method`: 'coins' | 'transfer'.
 * Visszaadja a sorokat ÁFÁ-val, az összesítőt és a fizetési határidőt.
 */
function buildInvoice({ number, issueDate, seller, buyer, lines, method = 'transfer', currency = 'EUR' }) {
  if (!number || !issueDate || !seller || !buyer || !Array.isArray(lines) || lines.length === 0) {
    throw new Error('invalid_invoice');
  }
  const vat = vatTreatment(buyer);
  const rows = lines.map((l) => {
    const qty = Math.max(1, Math.trunc(l.qty || 1));
    const net = Math.trunc(l.unitNetCents) * qty;
    const vatCents = Math.round((net * vat.pct) / 100);
    return { description: l.description, qty, unitNetCents: Math.trunc(l.unitNetCents), netCents: net, vatPct: vat.pct, vatCents, grossCents: net + vatCents };
  });
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return {
    number,
    issueDate,
    fulfilmentDate: issueDate,
    dueDate: method === 'transfer' ? addDays(issueDate, TRANSFER_DUE_DAYS) : issueDate,
    method,
    currency,
    seller,
    buyer,
    vat,
    lines: rows,
    totals: { netCents: sum('netCents'), vatCents: sum('vatCents'), grossCents: sum('grossCents') },
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function money(cents, currency) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} ${currency === 'EUR' ? '€' : currency}`;
}

/** Nyomtatható HTML-számlakép (a PDF a böngésző „nyomtatás PDF-be” útján). */
function renderInvoiceHtml(inv) {
  const party = (p) => `<strong>${esc(p.name)}</strong><br>${esc(p.address || '')}<br>${p.vatId ? `Adószám: ${esc(p.vatId)}` : ''}${p.regNumber ? `<br>Cégjegyzékszám: ${esc(p.regNumber)}` : ''}`;
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${money(l.unitNetCents, inv.currency)}</td><td>${money(l.netCents, inv.currency)}</td><td>${l.vatPct}%</td><td>${money(l.vatCents, inv.currency)}</td><td>${money(l.grossCents, inv.currency)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>Számla ${esc(inv.number)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.tot{text-align:right;margin-top:12px}.note{margin-top:12px;font-weight:600}</style></head><body>
<h1>Számla — ${esc(inv.number)}</h1>
<p>Kelt: ${esc(inv.issueDate)} · Teljesítés: ${esc(inv.fulfilmentDate)} · Fizetési határidő: ${esc(inv.dueDate)} · Fizetés: ${inv.method === 'transfer' ? 'átutalás' : 'ReMix Coin'}</p>
<div class="grid"><div><h3>Eladó</h3>${party(inv.seller)}</div><div><h3>Vevő</h3>${party(inv.buyer)}</div></div>
<table><thead><tr><th>Megnevezés</th><th>Menny.</th><th>Nettó egységár</th><th>Nettó</th><th>ÁFA</th><th>ÁFA összeg</th><th>Bruttó</th></tr></thead><tbody>${rows}</tbody></table>
<p class="tot">Nettó: ${money(inv.totals.netCents, inv.currency)} · ÁFA: ${money(inv.totals.vatCents, inv.currency)} · <strong>Fizetendő: ${money(inv.totals.grossCents, inv.currency)}</strong></p>
${inv.vat.note ? `<p class="note">${esc(inv.vat.note)}</p>` : ''}
</body></html>`;
}

module.exports = { HU_VAT_PCT, TRANSFER_DUE_DAYS, vatTreatment, buildInvoice, renderInvoiceHtml };
