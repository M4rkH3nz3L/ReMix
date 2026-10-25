const fs = require('fs');
const path = require('path');
const express = require('express');

const { verifyRequest } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { bugFileName, fingerprint, mergeBug, sanitizeReport } = require('../lib/bugReport');

/**
 * 🐞 Hibajelentés-fogadó: az app futásidejű hibái → `server/bugs/` mappa,
 * HIBÁNKÉNT EGY JSON-fájl (`<ujjlenyomat>_<slug>.json`), hogy javítani lehessen.
 *
 * Auth NEM kötelező (a login előtti crash is számít), de ha van érvényes token,
 * a hívó user-id-ja az előforduláshoz kerül. Védelem a nyitott végpontra:
 * rate-limit, 64 KB body-plafon, fájlszám-plafon (BUGS_MAX_FILES — fölötte új
 * hiba nem, csak a meglévők számlálója nő), fájlnév kizárólag hash+slug (nincs
 * útvonal-injektálás), atomi írás (tmp → rename), ujjlenyomatonként soros
 * feldolgozás (az egyidejű azonos jelentések nem veszítenek számlálót).
 */

const router = express.Router();

const BUGS_DIR = process.env.BUGS_DIR || path.join(__dirname, '..', 'bugs');
const MAX_FILES = Number(process.env.BUGS_MAX_FILES || 2000);

/** ujjlenyomatonkénti soros lánc (read-modify-write verseny ellen) */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {}).finally(() => {
      if (locks.get(key) === next) {
        locks.delete(key);
      }
    })
  );
  return next;
}

/** a már létező fájl az ujjlenyomathoz (a slug az első üzenetből jött — változhat) */
function findExisting(fp) {
  try {
    const hit = fs.readdirSync(BUGS_DIR).find((f) => f.startsWith(`${fp}_`) && f.endsWith('.json'));
    return hit ? path.join(BUGS_DIR, hit) : null;
  } catch {
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

router.post('/bugs', rateLimit('bugs'), express.json({ limit: '64kb' }), async (req, res) => {
  const report = sanitizeReport(req.body);
  if (!report) {
    res.status(400).json({ error: 'üres hibajelentés' });
    return;
  }
  // opcionális hitelesítés: token esetén a user-id a jelentéshez kerül
  let userId = null;
  try {
    const auth = await verifyRequest(req);
    userId = auth.ok ? auth.user.id : null;
  } catch {
    userId = null;
  }
  const fp = fingerprint(report);
  try {
    const result = await withLock(fp, () => {
      fs.mkdirSync(BUGS_DIR, { recursive: true });
      const existingPath = findExisting(fp);
      let existing = null;
      if (existingPath) {
        try {
          existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
        } catch {
          existing = null; // sérült fájl → újrakezdjük (a régi felülíródik)
        }
      } else {
        const count = fs.readdirSync(BUGS_DIR).filter((f) => f.endsWith('.json')).length;
        if (count >= MAX_FILES) {
          return { dropped: true };
        }
      }
      const merged = mergeBug(existing, report, fp, new Date().toISOString(), userId);
      const file = existingPath || path.join(BUGS_DIR, bugFileName(fp, report));
      writeAtomic(file, merged);
      if (!existing) {
        console.warn(`🐞 új hiba: ${path.basename(file)} — ${merged.title}`);
      }
      return { id: fp, count: merged.count, status: merged.status, file: path.basename(file) };
    });
    if (result.dropped) {
      res.status(507).json({ error: 'a bug-mappa megtelt', maxFiles: MAX_FILES });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'bug-írási hiba' });
  }
});

module.exports = router;
