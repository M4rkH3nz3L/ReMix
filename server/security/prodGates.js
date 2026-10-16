// 🔒 Prod-kapu assert (04-security §04.1). A három dev-kapu auth/rate-limit/billing
// védelmet kapcsol KI — production-ben SOHA nem lehetnek bekapcsolva (go-live blokkoló,
// DEPLOY.md:74). Pure selector → tesztelhető; az index.js az indulásnál refuse-ol.
//
//   ALLOW_INSECURE_DEV → auth-bypass (requireAuth átenged)
//   RL_DISABLED        → rate-limit no-op (DoS/költség-véd kikapcsol)
//   ALLOW_DEV_BILLING  → manuális Pro/kredit-végpontok nyitva

const DEV_GATES = ['ALLOW_INSECURE_DEV', 'RL_DISABLED', 'ALLOW_DEV_BILLING'];

/**
 * A production-ben TILTOTT, de bekapcsolt (`=== '1'`) dev-kapuk listája.
 * Nem-production env → mindig `[]` (dev/teszt szabadon használhatja a kapukat).
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function prodGateViolations(env = process.env) {
  if (env.NODE_ENV !== 'production') {
    return [];
  }
  return DEV_GATES.filter((g) => env[g] === '1');
}

/**
 * Indulás-idejű ellenőrzés: prod-ban bekapcsolt dev-kapura HIBA + `exit(1)` (az indulás
 * megtagadva). Injektálható `exit`/`log` → hálózat/process nélkül tesztelhető.
 * @returns {boolean} true, ha nincs sértés (indulhat)
 */
function assertProdGates(env = process.env, { exit = (c) => process.exit(c), log = console.error } = {}) {
  const bad = prodGateViolations(env);
  if (bad.length > 0) {
    log(
      `🔒 VÉGZETES: dev-kapu(k) bekapcsolva production-ben: ${bad.join(', ')} — ` +
        'ezek auth/rate-limit/billing védelmet kapcsolnak ki. Az indulás megtagadva ' +
        '(vedd ki a ' + bad.join('/') + ' env-változó(ka)t prod-ban).'
    );
    exit(1);
    return false;
  }
  return true;
}

module.exports = { prodGateViolations, assertProdGates, DEV_GATES };
