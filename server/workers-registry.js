// 🖥️ Render-WORKER-regiszter (Redis). Minden futó render-worker ide „jelentkezik
// be", és pár másodpercenként heartbeat-el: mit csinál ÉPPEN (melyik projektet,
// melyik fázisban), mennyire szabad. A „Sor" (schedules) nézet ebből mutatja
// meg élőben a worker-flottát — ikonnal, szereppel, aktuális feladatokkal.
//
// MIÉRT Redis és nem Postgres: ez ÉLŐ, mulandó állapot (5 mp-enkénti heartbeat).
// A queue amúgy is Redisben van, a lejárat (TTL) magától kitakarítja a halott
// workert, és nem terheljük a hosztolt prod adatbázist folyamatos írással.
const { connection } = require('./queue');

// ennyi ideig él egy worker-bejegyzés heartbeat nélkül (utána „offline"/eltűnik)
const WORKER_TTL_SEC = 20;
const INDEX_KEY = 'render:workers'; // az élő worker-id-k halmaza
const keyOf = (id) => `render:worker:${id}`;

/**
 * Worker-állapot beírása/frissítése (heartbeat). A `info` a kliensnek is
 * megjelenő nyers mezőket tartalmazza: { id, shortId, icon, roleKey,
 * concurrency, status, activeJobs, startedAt }. A `updatedAt`-ot itt tesszük rá.
 */
async function putWorker(info) {
  const r = connection();
  const payload = JSON.stringify({ ...info, updatedAt: Date.now() });
  await r.set(keyOf(info.id), payload, 'EX', WORKER_TTL_SEC);
  await r.sadd(INDEX_KEY, info.id);
}

/** Worker kivezetése a listából (graceful leállásnál). */
async function removeWorker(id) {
  const r = connection();
  await r.del(keyOf(id));
  await r.srem(INDEX_KEY, id);
}

/**
 * Az ÉLŐ workerek listája. A lejárt (TTL-en túli) bejegyzések maguktól
 * eltűnnek — az index-halmazból itt takarítjuk ki őket, hogy ne hízzon.
 */
async function listWorkers() {
  const r = connection();
  const ids = await r.smembers(INDEX_KEY);
  if (!ids.length) {
    return [];
  }
  const vals = await r.mget(ids.map(keyOf));
  const alive = [];
  const dead = [];
  ids.forEach((id, i) => {
    if (vals[i]) {
      try {
        alive.push(JSON.parse(vals[i]));
      } catch {
        dead.push(id);
      }
    } else {
      dead.push(id); // lejárt kulcs → halott
    }
  });
  if (dead.length) {
    await r.srem(INDEX_KEY, ...dead);
  }
  // frissen heartbeat-eltek elöl
  alive.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return alive;
}

module.exports = { putWorker, removeWorker, listWorkers, WORKER_TTL_SEC };
