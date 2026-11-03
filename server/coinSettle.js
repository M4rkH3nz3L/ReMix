const { logCaught } = require('./lib/caught');
// 🪙 Coin-tartás feloldó ütemező (PRO-CASH C0.3): a 30 napos tartásból kijött megkeresett
// Coin beválthatóvá válik, a 12 hónapos bónusz lejár. A DB a lusta úton (minden olvasás /
// költés előtt, `coin_settle`) már pontos; ez a futás azért kell, hogy a napló és az
// értesítések akkor is időben frissüljenek, ha a user nem nyitja meg az appot.
//
// Az `sb` injektálható (teszt); service_role nélkül no-op.

/** Egy futás: a `coin_release_due` RPC. Visszaadja az érintett userek számát (hibánál 0). */
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

module.exports = { runCoinSettleOnce };
