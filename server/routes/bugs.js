const path = require('path');
const express = require('express');

const { verifyToken } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { sanitizeReport } = require('../lib/bugReport');
const { LoadShedder, TokenCache } = require('../lib/bugGuards');
const { BugStore } = require('../lib/bugStore');

/**
 * 🐞 Hibajelentés-fogadó: az app futásidejű hibái → `server/bugs/` mappa,
 * HIBÁNKÉNT EGY JSON-fájl (`<ujjlenyomat>_<slug>.json`), hogy javítani lehessen.
 *
 * KÍMÉLETES a workerre (ami a renderelést/AI-t is kiszolgálja):
 *  - KÖTEGELT fogadás: `{ items: [...] }` (max 20) — a kliens offline-sora egy
 *    kérésben ürül; egyetlen jelentés objektumként is jöhet,
 *  - csak aszinkron fájlművelet, memória-index (nincs mappa-listázás kérésenként),
 *  - a token → user-id feloldás cache-elve (nem minden jelentés Supabase-hívás),
 *  - globális terhelés-levezetés: percenkénti plafon fölött 503 + Retry-After —
 *    a kliensek ennyi ideig nem próbálkoznak (visszalépnek),
 *  - IP-nkénti rate-limit, body-plafon, fájlszám-plafon, hash+slug fájlnév.
 * Az auth NEM kötelező (a login előtti crash is számít).
 */

const router = express.Router();

const store = new BugStore({
  dir: process.env.BUGS_DIR || path.join(__dirname, '..', 'bugs'),
  maxFiles: Number(process.env.BUGS_MAX_FILES || 2000),
});
const tokens = new TokenCache();
const shedder = new LoadShedder({ maxPerWindow: Number(process.env.BUGS_MAX_PER_MIN || 300) });

const MAX_BATCH = 20;

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '').trim());
  return m ? m[1].trim() : null;
}

/** opcionális user-id a tokenből — cache-elve (a hibás token is cache-el: null) */
async function resolveUserId(req) {
  const token = bearer(req);
  if (!token) {
    return null;
  }
  const now = Date.now();
  const cached = tokens.get(token, now);
  if (cached !== undefined) {
    return cached;
  }
  let userId = null;
  try {
    const res = await verifyToken(token);
    userId = res.ok ? res.user.id : null;
  } catch {
    userId = null;
  }
  tokens.set(token, userId, now);
  return userId;
}

router.post('/bugs', rateLimit('bugs'), express.json({ limit: '512kb' }), async (req, res) => {
  const body = req.body;
  const batched = Array.isArray(body?.items);
  const rawItems = batched ? body.items : [body];
  if (rawItems.length === 0 || rawItems.length > MAX_BATCH) {
    res.status(400).json({ error: `1–${MAX_BATCH} jelentés kérésenként` });
    return;
  }
  const reports = rawItems.map(sanitizeReport);
  const validCount = reports.filter(Boolean).length;
  if (validCount === 0) {
    res.status(400).json({ error: 'üres hibajelentés' });
    return;
  }
  // 🧯 terhelés-levezetés: hiba-viharban a kliensek visszalépnek (Retry-After)
  const admit = shedder.admit(validCount, Date.now());
  if (!admit.ok) {
    res.set('Retry-After', String(admit.retryAfterSec));
    res.status(503).json({ error: 'túl sok hibajelentés — később', retryAfterSec: admit.retryAfterSec });
    return;
  }
  const userId = await resolveUserId(req);
  try {
    const results = [];
    for (const report of reports) {
      if (!report) {
        results.push({ error: 'üres' });
        continue;
      }
      const r = await store.ingest(report, userId);
      if (r.isNew) {
        console.warn(`🐞 új hiba: ${r.file}`);
      }
      results.push(r);
    }
    if (!batched) {
      // egyetlen jelentésnél a korábbi válasz-alak megmarad
      const r = results[0];
      if (r.dropped) {
        res.status(507).json({ error: 'a bug-mappa megtelt' });
        return;
      }
      res.json({ ok: true, ...r });
      return;
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'bug-írási hiba' });
  }
});

module.exports = router;
