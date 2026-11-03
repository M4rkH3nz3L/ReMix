const { logCaught } = require('./lib/caught');
// 💸 Jóváhagyott kifizetések végrehajtása (PRO-CASH C3.3) — az állapotgépen át:
//   approved → processing → (partner-utalás) → paid | failed (failed → a DB visszaírja a Coint).
// A partner: PayPal Payouts (e-mail) vagy Stripe Connect (kapcsolt fiók). Ha a partner nincs
// bekötve, a kérés `approved` marad (kézi teljesítés), semmi nem vész el.
// Az `sb` és a küldők injektálhatók (teszt).

const { payoutsConfigured, sendPayout } = require('./payouts');
const { transferToAccount } = require('./stripeConnect');

function defaultSenders(env = process.env) {
  return {
    paypal: payoutsConfigured() ? (acct, req) => sendPayout(acct, req.amount_eur_cents, `ReMix payout ${req.id}`) : null,
    stripe: env.STRIPE_SECRET_KEY
      ? (acct, req) => transferToAccount({ accountId: acct.account_ref, amountEurCents: req.amount_eur_cents, requestId: req.id })
      : null,
  };
}

async function transition(sb, id, to, ref = null, note = null) {
  const { error } = await sb.rpc('payout_transition', { p_request: id, p_to: to, p_provider_ref: ref, p_note: note });
  if (error) {
    throw new Error(error.message);
  }
}

/** Egy jóváhagyott kérés végrehajtása. Visszaadja a végállapotot ('paid' | 'failed' | 'approved'). */
async function executeApproved(sb, req, acct, senders = defaultSenders()) {
  const send = acct && senders[acct.provider];
  if (!send) {
    return 'approved'; // nincs bekötött partner → kézi teljesítés
  }
  await transition(sb, req.id, 'processing');
  try {
    const ref = await send(acct, req);
    await transition(sb, req.id, 'paid', ref || null);
    return 'paid';
  } catch (caught) {
    logCaught('payoutRunner.js:executeApproved', caught);
    await transition(sb, req.id, 'failed', null, String((caught && caught.message) || caught).slice(0, 300));
    return 'failed';
  }
}

/** Az összes jóváhagyott (pl. kézi ellenőrzésen átment) kérés feldolgozása — az ütemező hívja. */
async function runApprovedPayouts(sb, senders = defaultSenders(), limit = 20) {
  const out = { paid: 0, failed: 0, waiting: 0 };
  if (!sb) {
    return out;
  }
  try {
    const { data: rows, error } = await sb
      .from('payout_requests')
      .select('id, user_id, cents, amount_eur_cents')
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      throw new Error(error.message);
    }
    for (const req of rows || []) {
      const { data: acct } = await sb
        .from('payout_accounts')
        .select('provider, email, account_ref, kyc_status')
        .eq('user_id', req.user_id)
        .maybeSingle();
      const end = acct && acct.kyc_status === 'verified' ? await executeApproved(sb, req, acct, senders) : 'approved';
      if (end === 'paid') out.paid += 1;
      else if (end === 'failed') out.failed += 1;
      else out.waiting += 1;
    }
  } catch (caught) {
    logCaught('payoutRunner.js:runApprovedPayouts', caught);
  }
  return out;
}

module.exports = { executeApproved, runApprovedPayouts, defaultSenders };
