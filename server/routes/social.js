// 🔔 Social route-ok (értesítés-küldés + projekt-meghívó).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből
// (címzettenkénti jogosultság-ellenőrzés + 503-precedencia megőrizve).

const express = require('express');

const { callerId, requireAuth, INSECURE_DEV } = require('../auth');
const { paidOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { notifyAvailable, sendNotification, canNotify, inviteMember } = require('../notify');

const router = express.Router();

// 🔔 Értesítés-küldés (service_role): SELF + CROSS-USER (team-working). Beszúr a
// notifications-be (realtime kézbesíti) + best-effort Expo push a push_tokenekre.
// ⚠️ PROD: JWT-verifikáció + hívó-jogosultság (ki kinek küldhet) mögé kell tenni,
//    lásd TODO.md „Biztonság" (a worker ma nem hitelesít).
router.post('/notify', express.json({ limit: '64kb' }), requireAuth, rateLimit('messaging'), (req, res) => {
  if (!notifyAvailable()) {
    res.status(503).json({ error: 'notify nincs konfigurálva (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  // 🔐 Címzettenkénti jogosultság (OWASP API1/API5): a hitelesítés már megszüntette
  // a NÉVTELEN spamet; ez a lépés a CROSS-USER spam/phishinget is lezárja. Csak
  // akkor mehet értesítés, ha a hívó és a címzett közt VAN kapcsolat: saját maga,
  // közös projekt (collab), vagy follow-él (social) — `canNotify` dönt. A címzett
  // a body `userId`-ja. INSECURE_DEV-ben a kapu kimarad (lokális fejlesztés).
  const caller = callerId(req, 'dev');
  if (!caller) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  const recipient = String(req.body?.userId || '').trim();
  const gate = INSECURE_DEV ? Promise.resolve(true) : canNotify(caller, recipient);
  gate
    .then((allowed) => {
      if (!allowed) {
        res
          .status(403)
          .json({ error: 'Nincs jogosultság értesítést küldeni ennek a felhasználónak.' });
        return undefined;
      }
      return sendNotification(req.body ?? {}).then((result) => res.json(result));
    })
    .catch((err) => {
      console.error('Notify hiba:', err.message);
      if (!res.headersSent) {
        res.status(400).json({ error: err.message });
      }
    });
});

// 👥 Meghívás egy projektbe (service_role): e-mail → tag hozzáadás VAGY pending
// invite + „meghívtak" értesítés. A névfeloldás (auth.users e-mail) miatt kell a
// worker (a kliens az RLS-en nem lát más e-mailt). ⚠️ PROD: JWT + „ki hívhat meg"
// jogosultság (csak a tulaj) mögé — lásd TODO.md Biztonság.
// 🤝 collab-meghívás: a MEGHÍVÓ (projekt-tulaj) min. Amatőr (TECH-TOP §4: „collab = Amatőr+").
// A meghívott bárki lehet (a fizető gazda projektjéhez csatlakozik). INSECURE_DEV bypassol.
router.post('/invite', express.json({ limit: '32kb' }), ...paidOnly, rateLimit('messaging'), (req, res) => {
  if (!notifyAvailable()) {
    res.status(503).json({ error: 'invite nincs konfigurálva (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  // 🔐 CSAK A TULAJ hívhat meg: az `ownerId` nem a body-ból érvényes, hanem a
  // verifikált tokenből. Enélkül bárki felvehette magát `editor`-ként BÁRMELY
  // projektbe (az RLS-t megkerülve), ha ismerte az owner/project id-t.
  const owner = callerId(req, req.body?.ownerId);
  if (!owner) {
    res.status(401).json({ error: 'Nem azonosítható hívó.' });
    return;
  }
  if (req.user && req.body?.ownerId && req.body.ownerId !== owner) {
    res.status(403).json({ error: 'Csak a projekt tulajdonosa hívhat meg tagot.' });
    return;
  }
  inviteMember({ ...(req.body ?? {}), ownerId: owner, invitedBy: owner })
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Invite hiba:', err.message);
      res.status(400).json({ error: err.message });
    });
});

module.exports = router;
