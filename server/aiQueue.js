// 🧠 A saját AI (DGX Spark) kapacitás-sora (PRO-CASH 7.2, C5.3).
//
// Egy gép = véges kapacitás: legfeljebb `concurrency` kérés fut egyszerre, a többi PRIORITÁS
// szerint vár (Vállalati és Profi előbb, Amatőr és Haladó utána; azonos prioritáson érkezési
// sorrend). Ha a sor tele, a kérés AZONNAL `AiOverloadedError`-t kap a becsült várakozással —
// a felület ilyenkor a telefonos modellt vagy a saját kulcsot (BYOK) ajánlja fel.
// Tiszta, függőségmentes; az órát és a mért átlagidőt a hívó adja (teszt).

class AiOverloadedError extends Error {
  constructor(etaSec) {
    super('ai_overloaded');
    this.name = 'AiOverloadedError';
    this.status = 503;
    this.payload = { etaSec, fallback: ['on_device', 'byok'] };
  }
}

/** A szint prioritása (kisebb = előbb). */
function tierPriority(tier) {
  return tier === 'business' || tier === 'ultra' ? 0 : 1;
}

function createAiQueue({ concurrency = 4, maxQueue = 32, avgMs = 8000 } = {}) {
  let active = 0;
  let seq = 0;
  let avg = avgMs;
  const waiting = []; // { prio, seq, resolve }

  function next() {
    if (active >= concurrency || waiting.length === 0) {
      return;
    }
    waiting.sort((a, b) => a.prio - b.prio || a.seq - b.seq);
    const w = waiting.shift();
    active += 1;
    w.resolve();
  }

  /** Becsült várakozás másodpercben, ha most állna be a sorba. */
  function etaSec(prio = 1) {
    const ahead = waiting.filter((w) => w.prio <= prio).length;
    return Math.ceil(((ahead + 1) * avg) / Math.max(1, concurrency) / 1000);
  }

  /** Futtat egy feladatot, ha kap helyet; a mért időből tanulja az átlagot. */
  async function run(tier, fn, now = () => Date.now()) {
    const prio = tierPriority(tier);
    if (active >= concurrency) {
      if (waiting.length >= maxQueue) {
        throw new AiOverloadedError(etaSec(prio));
      }
      await new Promise((resolve) => waiting.push({ prio, seq: seq++, resolve }));
    } else {
      active += 1;
    }
    const started = now();
    try {
      return await fn();
    } finally {
      const took = now() - started;
      if (took > 0) {
        avg = Math.round(avg * 0.8 + took * 0.2);
      }
      active -= 1;
      next();
    }
  }

  function stats() {
    return { active, waiting: waiting.length, concurrency, maxQueue, avgMs: avg };
  }

  return { run, stats, etaSec };
}

module.exports = { createAiQueue, AiOverloadedError, tierPriority };
