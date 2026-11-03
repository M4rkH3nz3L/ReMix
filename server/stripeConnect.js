// 🪪 Stripe Connect Express — KYC és alkotói kifizetés (PRO-CASH C3.3, 2.5, 8.3–8.4).
//
// A KYC-t (név, cím, adószám, bankszámla, születési dátum — a DAC7-hez is) a Stripe végzi;
// nálunk csak a fiók-azonosító (`acct_…`) és az állapot van (8.6). A pénzt a Stripe mozgatja
// a platform-egyenlegről a kapcsolt fiókra (`/v1/transfers`), így nem mi vagyunk e-pénz-
// kibocsátók (8.3). Minden hívás `fetchImpl`-lel injektálható (teszt); kulcs: STRIPE_SECRET_KEY.

const API = 'https://api.stripe.com/v1';

async function stripePost(path, params, env, fetchImpl, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const res = await fetchImpl(`${API}${path}`, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || `Stripe hiba (${res.status})`);
  }
  return data;
}

/** Express-fiók az alkotónak (csak utalás-fogadás). Visszaadja az `acct_…` azonosítót. */
async function createExpressAccount({ userId, email }, env = process.env, fetchImpl = fetch) {
  const params = {
    type: 'express',
    'capabilities[transfers][requested]': 'true',
    'business_profile[product_description]': 'ReMix alkotói bevétel (sablon-eladás, ajándék, jutalék)',
    'metadata[user_id]': userId,
  };
  if (email) {
    params.email = email;
  }
  const data = await stripePost('/accounts', params, env, fetchImpl, `acct-${userId}`);
  return data.id;
}

/** Az onboarding (KYC) oldal egyszer használatos címe. */
async function onboardingLink({ accountId, refreshUrl, returnUrl }, env = process.env, fetchImpl = fetch) {
  const data = await stripePost(
    '/account_links',
    { account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' },
    env,
    fetchImpl
  );
  return data.url;
}

/** Utalás a kapcsolt fiókra; a kérés-id az idempotencia-kulcs (újrapróbálásnál sincs dupla utalás). */
async function transferToAccount({ accountId, amountEurCents, requestId }, env = process.env, fetchImpl = fetch) {
  const data = await stripePost(
    '/transfers',
    {
      amount: String(Math.trunc(amountEurCents)),
      currency: 'eur',
      destination: accountId,
      'metadata[payout_request]': requestId,
    },
    env,
    fetchImpl,
    `payout-${requestId}`
  );
  return data.id;
}

/**
 * A kapcsolt fiók állapota → KYC-állapot (tiszta). `account.updated` webhook-objektumból:
 * verified: a fiók kitöltve és kifizethető · rejected: a Stripe elutasította · pending: folyamatban.
 */
function kycStatusFromAccount(account) {
  const reason = String((account && account.requirements && account.requirements.disabled_reason) || '');
  if (reason.startsWith('rejected')) {
    return 'rejected';
  }
  if (account && account.details_submitted && account.payouts_enabled) {
    return 'verified';
  }
  return 'pending';
}

module.exports = { createExpressAccount, onboardingLink, transferToAccount, kycStatusFromAccount };
