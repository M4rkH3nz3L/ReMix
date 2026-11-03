const { logCaught } = require('./lib/caught');
// 🏢 Cégellenőrzés (PRO-CASH C4.2, 5.1): EU-s adószám a VIES-en, céges e-mail-domain.
// Az eredmény a szervezet `verification` mezőjébe kerül; a jóváhagyás KÉZI (finance.manage
// admin), ez csak a döntés alapja. A `fetchImpl` injektálható (teszt / mock).

const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';
// a VIES Görögországot EL-ként ismeri
const VIES_CC = { GR: 'EL' };
const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'freemail.hu', 'citromail.hu', 'gmx.net', 'gmx.de', 'web.de', 'proton.me', 'protonmail.com', 'aol.com', 'mail.com']);

function isEu(country) {
  return EU.has(String(country || '').toUpperCase());
}

/** Az adószám országkód nélküli része ("HU12345678" → "12345678"). */
function vatNumberPart(country, vatId) {
  const cc = VIES_CC[country] || country;
  const v = String(vatId || '').toUpperCase().replace(/[\s.-]/g, '');
  return v.startsWith(cc) ? v.slice(cc.length) : v.startsWith(country) ? v.slice(country.length) : v;
}

/** VIES-lekérdezés. Visszaadja: { valid, name, address, checkedAt } vagy { valid:null, error } (elérhetetlen). */
async function checkVies(country, vatId, fetchImpl = fetch) {
  const cc = String(country || '').toUpperCase();
  if (!isEu(cc) || !vatId) {
    return { valid: false, reason: 'not_eu_or_missing' };
  }
  const url = `${VIES_URL}/${VIES_CC[cc] || cc}/vat/${encodeURIComponent(vatNumberPart(cc, vatId))}`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!res.ok || typeof data.isValid !== 'boolean') {
      return { valid: null, error: (data && (data.userError || data.errorWrappers?.[0]?.error)) || `vies_${res.status}` };
    }
    return { valid: data.isValid, name: data.name || null, address: data.address || null, checkedAt: new Date().toISOString() };
  } catch (caught) {
    logCaught('companyVerify.js:checkVies', caught);
    return { valid: null, error: 'vies_unreachable' };
  }
}

/** Céges domain: a számlázási e-mail a cég domainjén van, és nem ingyenes levelező. */
function checkDomain(billingEmail, domain) {
  const at = String(billingEmail || '').toLowerCase().split('@')[1] || '';
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  return { ok: !!d && at === d && !FREE_MAIL.has(d), emailDomain: at || null, freeMail: FREE_MAIL.has(at) };
}

/** Teljes ellenőrzés egy szervezetre (a `verification` jsonb-be írandó). */
async function verifyCompany(org, fetchImpl = fetch) {
  const vies = await checkVies(org.country, org.vat_id, fetchImpl);
  const domain = checkDomain(org.billing_email, org.domain);
  return { vies, domain, eu: isEu(org.country), checkedAt: new Date().toISOString() };
}

module.exports = { isEu, vatNumberPart, checkVies, checkDomain, verifyCompany };
