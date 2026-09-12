// 💳 Billing — a Pro szint EGYETLEN hiteles forrása a `subscriptions` táblában.
//
// A kliens SOHA nem grantel Pro-t magának (a subscriptions írás service_role-only,
// RLS tiltja). A Pro-t KIZÁRÓLAG ez a modul állítja:
//   • RevenueCat webhook (VALÓS pénz-út: App Store / Play IAP → /billing/revenuecat)
//   • /billing/activate (dev/manuális/promó — ugyanaz a belső activatePro)
//
// Egy időszak alapból 30 nap. A webhook a store-tól kapott `expiration_at_ms`-t
// használja (hiteles lejárat); a manuális aktiválás mosttól (vagy a meglévő
// lejárattól) hosszabbít 30 nappal (megújítás).
const { adminClient } = require('./notify');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;

/** Be van-e kötve a service_role (megy-e a billing-írás). */
function billingAvailable() {
  return !!adminClient();
}

/**
 * Pro aktiválása/megújítása a `subscriptions`-ben (service_role → RLS-bypass).
 * `opts.until` (ISO/ms): explicit lejárat (webhook). Különben `opts.days` (def. 30)
 * a meglévő érvényes lejárattól, vagy mosttól.
 */
async function activatePro(userId, opts = {}) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nincs beállítva a workeren.');
  }
  const uid = String(userId || '').trim();
  if (!uid) {
    throw new Error('userId kötelező.');
  }
  const source = opts.source || 'manual';
  const now = Date.now();

  let endMs;
  if (opts.until != null) {
    endMs = typeof opts.until === 'number' ? opts.until : Date.parse(opts.until);
    if (Number.isNaN(endMs)) {
      throw new Error('Érvénytelen lejárat (until).');
    }
  } else {
    const days = Number.isFinite(opts.days) ? opts.days : DEFAULT_DAYS;
    // megújítás: ha még érvényes a Pro, ONNAN hosszabbítunk, különben mosttól
    const { data: cur } = await sb
      .from('subscriptions')
      .select('current_period_end, tier')
      .eq('user_id', uid)
      .maybeSingle();
    const curEnd = cur?.current_period_end ? Date.parse(cur.current_period_end) : NaN;
    const base = cur?.tier === 'pro' && !Number.isNaN(curEnd) && curEnd > now ? curEnd : now;
    endMs = base + days * DAY_MS;
  }

  const end = new Date(endMs).toISOString();
  const { error } = await sb.from('subscriptions').upsert(
    { user_id: uid, tier: 'pro', status: 'active', current_period_end: end, source },
    { onConflict: 'user_id' }
  );
  if (error) {
    throw new Error(error.message);
  }
  return { tier: 'pro', proUntil: end };
}

/**
 * 🪙 Kredit jóváírása (Shop top-up) — service_role, a grant_credits RPC-n át.
 * IAP consumable (RevenueCat) vagy dev/manuális. Visszaadja az új egyenleget.
 */
async function grantCredits(userId, amount, kind = 'topup', note = null) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nincs beállítva a workeren.');
  }
  const uid = String(userId || '').trim();
  const amt = Math.trunc(Number(amount));
  if (!uid || !Number.isFinite(amt) || amt <= 0) {
    throw new Error('userId és pozitív amount kötelező.');
  }
  const { data, error } = await sb.rpc('grant_credits', {
    p_user: uid,
    p_amount: amt,
    p_kind: kind,
    p_note: note,
  });
  if (error) {
    throw new Error(error.message);
  }
  return { balance: data };
}

/** Pro visszavonása (lejárat/visszatérítés/lemondás után). */
async function deactivatePro(userId, opts = {}) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nincs beállítva a workeren.');
  }
  const uid = String(userId || '').trim();
  if (!uid) {
    throw new Error('userId kötelező.');
  }
  const { error } = await sb
    .from('subscriptions')
    .update({ tier: 'free', status: opts.status || 'canceled', source: opts.source || 'manual' })
    .eq('user_id', uid);
  if (error) {
    throw new Error(error.message);
  }
  return { tier: 'free', proUntil: null };
}

// RevenueCat esemény-típusok: mikor GRANTolunk (a store-lejáratig) és mikor VONUNK VISSZA.
// A CANCELLATION/BILLING_ISSUE NEM von vissza azonnal — a hozzáférés a lejáratig tart.
const RC_GRANT = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
]);
const RC_REVOKE = new Set(['EXPIRATION', 'REFUND']);

/**
 * RevenueCat webhook-esemény feldolgozása. A `body.event.app_user_id` a mi
 * user-id-nk (a kliens `Purchases.logIn(userId)`-vel köti). `expiration_at_ms`
 * a hiteles lejárat.
 */
async function handleRevenueCatEvent(body) {
  const ev = (body && body.event) || {};
  const uid = ev.app_user_id;
  if (!uid) {
    throw new Error('app_user_id hiányzik az eseményből.');
  }
  const type = ev.type;
  // 🪙 Shop kredit-csomag (consumable): a product_id `credits_<n>` alakú → n kredit
  const creditMatch = /^credits_(\d+)$/.exec(String(ev.product_id || ''));
  if (creditMatch && (type === 'NON_RENEWING_PURCHASE' || type === 'INITIAL_PURCHASE')) {
    const amount = parseInt(creditMatch[1], 10);
    await grantCredits(uid, amount, 'topup', ev.product_id);
    return { credited: amount };
  }
  if (RC_GRANT.has(type)) {
    return activatePro(uid, {
      source: 'revenuecat',
      until: ev.expiration_at_ms ?? null,
      days: DEFAULT_DAYS,
    });
  }
  if (RC_REVOKE.has(type)) {
    return deactivatePro(uid, {
      source: 'revenuecat',
      status: type === 'EXPIRATION' ? 'expired' : 'canceled',
    });
  }
  return { ignored: type || 'unknown' };
}

module.exports = {
  billingAvailable,
  activatePro,
  deactivatePro,
  grantCredits,
  handleRevenueCatEvent,
};
