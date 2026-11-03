const { logCaught } = require('./lib/caught');
// 🪙 A Coin-gazdaság ütemezett futásai (PRO-CASH C0.3 + C1.3), óránként:
//   1. tartás-feloldás és bónusz-lejárat (`coin_release_due`) — a DB minden olvasáskor
//      lustán is felold; ez a napló és az értesítések időbenisége miatt fut;
//   2. a lejárt Coin-előfizetések megújítása (`renew_due_subscriptions`): a függő lefelé
//      váltás és a levett add-onok ilyenkor lépnek életbe; kevés Coinnál past_due → Free;
//   3. megújítási értesítés 3 nappal a lejárat előtt, ha kevés a Coin (`take_renewal_notices`,
//      periódusonként egyszer), a próba végéről 2 nappal előtte (`take_trial_notices`, C2.4), és a
//      kereten túli felhő-tárhely türelmi idejének vége előtt 7 nappal (`take_storage_grace_notices`, C1.6).
// Az `sb`, a `now` és az értesítő injektálható (teszt); service_role nélkül no-op.

/** Egy futás: a coin_release_due RPC. Visszaadja az érintett userek számát (hibánál 0). */
async function runCoinSettleOnce(sb, now = new Date()) {
  if (!sb) {
    return 0;
  }
  try {
    const { data, error } = await sb.rpc('coin_release_due', { p_now: now.toISOString() });
    if (error) {
      throw new Error(error.message);
    }
    return Number(data) || 0;
  } catch (caught) {
    logCaught('coinSettle.js:runCoinSettleOnce', caught);
    return 0;
  }
}

/** A megújítási értesítés szövege (magyar alapértelmezés; a route a pénztárcára visz). */
function renewalNotice(row) {
  const need = Math.max(0, Number(row.cost_cents) - Number(row.balance_cents)) / 100;
  const date = new Date(row.period_end).toISOString().slice(0, 10);
  return {
    userId: row.user_id,
    type: 'info',
    title: 'Hamarosan megújul az előfizetésed',
    body: `${date}-án megújul, de ${need.toFixed(2).replace('.', ',')} Coin hiányzik. Tölts fel, hogy ne ess vissza Free-re.`,
    route: '/profile',
    data: { kind: 'subscription_renewal', period_end: row.period_end },
  };
}

/**
 * Egy ciklus-futás: megújítás + értesítések. Visszaadja: { renewed, failed, ended, notified }.
 * `notify`: a sendNotification (injektálható); egy értesítés hibája nem állítja meg a többit.
 */
async function runSubscriptionCycleOnce(sb, now = new Date(), notify = null) {
  const out = { renewed: 0, failed: 0, ended: 0, notified: 0 };
  if (!sb) {
    return out;
  }
  try {
    const { data, error } = await sb.rpc('renew_due_subscriptions', { p_now: now.toISOString() });
    if (error) {
      throw new Error(error.message);
    }
    Object.assign(out, { renewed: data?.renewed || 0, failed: data?.failed || 0, ended: data?.ended || 0 });
  } catch (caught) {
    logCaught('coinSettle.js:runSubscriptionCycleOnce:renew', caught);
  }
  try {
    const { data: rows, error } = await sb.rpc('take_renewal_notices', { p_now: now.toISOString() });
    if (error) {
      throw new Error(error.message);
    }
    const send = notify || require('./notify').sendNotification;
    for (const row of rows || []) {
      try {
        await send(renewalNotice(row));
        out.notified += 1;
      } catch (caught) {
        logCaught('coinSettle.js:runSubscriptionCycleOnce:notify', caught);
      }
    }
  } catch (caught) {
    logCaught('coinSettle.js:runSubscriptionCycleOnce:notices', caught);
  }
  try {
    const { data: trials, error } = await sb.rpc('take_trial_notices', { p_now: now.toISOString() });
    if (error) {
      throw new Error(error.message);
    }
    const send = notify || require('./notify').sendNotification;
    for (const row of trials || []) {
      try {
        await send(trialNotice(row));
        out.notified += 1;
      } catch (caught) {
        logCaught('coinSettle.js:runSubscriptionCycleOnce:trialNotify', caught);
      }
    }
  } catch (caught) {
    logCaught('coinSettle.js:runSubscriptionCycleOnce:trials', caught);
  }
  try {
    const { data: graces, error } = await sb.rpc('take_storage_grace_notices', { p_now: now.toISOString() });
    if (error) {
      throw new Error(error.message);
    }
    const send = notify || require('./notify').sendNotification;
    for (const row of graces || []) {
      try {
        await send(storageGraceNotice(row));
        out.notified += 1;
      } catch (caught) {
        logCaught('coinSettle.js:runSubscriptionCycleOnce:graceNotify', caught);
      }
    }
  } catch (caught) {
    logCaught('coinSettle.js:runSubscriptionCycleOnce:grace', caught);
  }
  return out;
}

/** A felhő-tárhely türelmi idejének vége (C1.6): semmit nem törlünk, de a feltöltés zárva marad. */
function storageGraceNotice(row) {
  const date = new Date(row.grace_until).toISOString().slice(0, 10);
  const gb = (Number(row.over_bytes) / 1073741824).toFixed(1).replace('.', ',');
  return {
    userId: row.user_id,
    type: 'info',
    title: 'A felhő-tárhelyed a kereten túl van',
    body: `${gb} GB-tal több a keretednél. ${date}-ig töltsd le vagy költöztesd a saját felhődbe, vagy bővíts — törölni semmit nem fogunk.`,
    route: '/profile',
    data: { kind: 'storage_grace', grace_until: row.grace_until },
  };
}

/** A próba végéről szóló értesítés (C2.4): automatikus terhelés nincs, a user dönt. */
function trialNotice(row) {
  const date = new Date(row.ends_at).toISOString().slice(0, 10);
  return {
    userId: row.user_id,
    type: 'info',
    title: 'Hamarosan véget ér az Amatőr-próbád',
    body: `${date}-án lejár, utána Free-re váltasz — semmit nem terhelünk. Ha maradnál, válassz csomagot.`,
    route: '/profile',
    data: { kind: 'trial_ending', ends_at: row.ends_at },
  };
}

module.exports = { runCoinSettleOnce, runSubscriptionCycleOnce, renewalNotice, trialNotice, storageGraceNotice };
