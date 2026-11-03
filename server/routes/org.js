const { logCaught } = require('../lib/caught');
// 🏢 Szervezeti route-ok (PRO-CASH C4.2, C4.4). Domain-router (01-api-architecture §01.1).
// A hívó a VERIFIKÁLT tokenből; a szervezeti szerepkört (owner/admin) a DB `org_role` dönti el.

const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { adminClient } = require('../notify');
const { verifyCompany } = require('../companyVerify');
const { buildInvoice, renderInvoiceHtml, vatTreatment, TRANSFER_DUE_DAYS } = require('../invoice');

const router = express.Router();

// az eladó (ReMix) adatai a számlán — env-ből (élesítés előtt a könyvelő adja meg)
function sellerParty() {
  return {
    name: process.env.INVOICE_SELLER_NAME || 'ReMix',
    address: process.env.INVOICE_SELLER_ADDRESS || '',
    vatId: process.env.INVOICE_SELLER_VAT_ID || '',
    regNumber: process.env.INVOICE_SELLER_REG_NUMBER || '',
  };
}

/** A hívó szervezete és szerepköre; null, ha nem owner/admin. */
async function orgForAdmin(sb, uid) {
  const { data: m } = await sb.from('org_members').select('org_id, role').eq('user_id', uid).maybeSingle();
  if (!m || !['owner', 'admin'].includes(m.role)) {
    return null;
  }
  const { data: org } = await sb.from('organizations').select('*').eq('id', m.org_id).maybeSingle();
  return org || null;
}

function buyerParty(org) {
  return {
    name: org.name,
    address: org.billing_address || '',
    country: org.country,
    vatId: org.vat_id || '',
    regNumber: org.reg_number || '',
    vatValid: !!(org.verification && org.verification.vies && org.verification.vies.valid === true),
  };
}

// C4.2: cégellenőrzés (VIES + céges domain) — az eredmény a döntés alapja, a jóváhagyás kézi
router.post('/org/verify', requireAuth, rateLimit('messaging'), express.json({ limit: '4kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  const sb = adminClient();
  if (!uid || !sb) {
    res.status(uid ? 503 : 401).json({ error: uid ? 'service_role hiányzik' : 'Hiányzó felhasználó.' });
    return;
  }
  try {
    const org = await orgForAdmin(sb, uid);
    if (!org) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const result = await verifyCompany(org);
    const { error } = await sb.rpc('org_record_verification', { p_org: org.id, p_result: result });
    if (error) {
      throw new Error(error.message);
    }
    res.json(result);
  } catch (err) {
    logCaught('routes/org.js:verify', err);
    res.status(500).json({ error: err.message });
  }
});

// C4.4: átutalásos számla kérése (nettó 15 nap); az ÁFA a vevő országából és VIES-eredményéből
router.post('/org/invoice', requireAuth, rateLimit('messaging'), express.json({ limit: '4kb' }), async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  const sb = adminClient();
  if (!uid || !sb) {
    res.status(uid ? 503 : 401).json({ error: uid ? 'service_role hiányzik' : 'Hiányzó felhasználó.' });
    return;
  }
  const months = Number(req.body?.months) === 12 ? 12 : 1;
  const seats = Math.trunc(Number(req.body?.seats) || 0);
  try {
    const org = await orgForAdmin(sb, uid);
    if (!org) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const buyer = buyerParty(org);
    const vat = vatTreatment(buyer);
    const { data, error } = await sb.rpc('issue_org_invoice', {
      p_org: org.id, p_months: months, p_seats: seats, p_vat_pct: vat.pct, p_vat_code: vat.code, p_buyer: buyer, p_due_days: TRANSFER_DUE_DAYS,
    });
    if (error) {
      const known = /org_not_verified|seats_below_members|invalid params/.exec(error.message);
      res.status(known ? 400 : 500).json({ error: known ? known[0] : error.message });
      return;
    }
    res.json(data);
  } catch (err) {
    logCaught('routes/org.js:invoice', err);
    res.status(500).json({ error: err.message });
  }
});

// a számla nyomtatható képe (a szervezet owner/adminjának)
router.get('/org/invoice/:id', requireAuth, async (req, res) => {
  const uid = callerId(req, req.query.userId);
  const sb = adminClient();
  if (!uid || !sb) {
    res.status(uid ? 503 : 401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const org = await orgForAdmin(sb, uid);
    const { data: inv } = await sb.from('invoices').select('*').eq('id', String(req.params.id)).maybeSingle();
    if (!org || !inv || inv.org_id !== org.id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const doc = buildInvoice({
      number: inv.number,
      issueDate: String(inv.issued_at).slice(0, 10),
      seller: sellerParty(),
      buyer: inv.buyer,
      method: inv.method,
      lines: [{ description: `ReMix Vállalati — ${inv.seats} fő, ${inv.months === 12 ? '12 hónap' : '1 hónap'}`, qty: inv.seats, unitNetCents: Math.round(inv.net_cents / inv.seats) }],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderInvoiceHtml(doc));
  } catch (err) {
    logCaught('routes/org.js:invoiceHtml', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
