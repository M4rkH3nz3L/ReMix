# 🟠 10. Messaging safety & moderation — P1

> **Forrás:** [remix.md](../../source/remix.md) §23 (messaging hiányok), részben §21 (social backend).
> **Kapcsolódó:** [social-feed-architecture] (feed/comment/owner-moderáció **van**) · [rbac-roles-permissions] (moderator/admin szerep).
> **Érintett kód:** `messages` / `conversation_members` táblák + RLS · [server/notify.js](../../../server/notify.js) · [01](./01-worker-auth-policy.md) (business-flow authz).

---

## 0. Kontextus & cél

A messaging-alap erős: DM, project-chat, group-chat, members, last-read, realtime, message-ownership, notification-trigger, RLS a `messages`/`conversation_members`-en. **A user-safety és moderation-réteg hiányzik.**

**Cél:** a messaging + social interakció legyen **abuse-ellenálló**: block/mute/report, attachment-security, spam-throttling, és moderation-tooling.

---

## 1. Jelenlegi állapot (bizonyíték)
- 🟢 DM/project/group-chat, members, last-read, realtime, message-ownership, notification-trigger, group-management, RLS.
- ❌ Hiányzik: block user, mute conversation, message-reporting, spam-throttling, message-edit-audit, attachment-security, link-preview-security, abuse-detection, message-retention, moderation-tooling, (opcionális) E2E-encryption stratégia.

---

## 2. Megoldás

### 2.1 User-safety primitívek
- **Block:** `user_blocks(blocker, blocked)` tábla + RLS; blokkolt user nem küldhet DM-et, nem lát/kommentel — a feed/comment/DM-lekérdezések szűrnek rá.
- **Mute:** `conversation_mutes(user, conversation)` — némítás értesítés nélkül.
- **Report:** message/conversation-report a meglévő `reports`-mintára ([social-feed-architecture]).

### 2.2 Attachment & link security
- Az attachmentek a `mediaUpload()` pipeline-on ([02](./02-upload-security.md)) mennek át (típus/méret/MIME), privát bucketbe ([05](./05-storage-security.md)), signed-URL-lel.
- Link-preview: a preview-fetch az SSRF-policy-n ([04](./04-ssrf-protection.md)) át; a preview-t a **worker** készíti, nem a kliens fetch-eli tetszőleges URL-t.

### 2.3 Abuse & throttling
- `messaging` rate-limit osztály ([03](./03-rate-limiting.md)) user + conversation kulcson; új-DM burst-limit (spam).
- `/notify` címzett-authz ([01](./01-worker-auth-policy.md) §2.4) — nincs tetszőleges-címzett notification.
- Message-edit-audit (ki/mikor/mit editált) → [14](./14-security-baseline-docs.md).

### 2.4 Moderation-tooling
- Moderator/admin ([rbac-roles-permissions]) felület: reportált üzenetek sora, művelet (törlés/figyelmeztetés/ban), audit.
- Message-retention policy ([09](./09-account-lifecycle-gdpr.md) RETENTION-nal összhangban).

---

## 3. Feladatok
### 🟦 Fázis A — Safety primitívek
- [x] `user_blocks` + `conversation_mutes` táblák + RLS + migráció (`20261003140000`),
      kliens data-layer: `src/lib/blocks.ts`.
- [x] Block/mute bekötése: DM-küldés tiltás (restrictive messages-policy, `140000`)
      **+ feed/komment-láthatóság szűrése** (`viewer_blocks` helper + `posts_select` /
      `comments_select`, `20261003150000`). A blokkolt user posztja/kommentje **nem
      látszik** a blokkoló feedjében (kétirányú).
- [x] Message-report: `reports` kiterjesztve `message` célra (`150000`) + kliens
      `reportMessage()` (`src/lib/reports.ts`). *(Hátra: a moderation-queue UI
      message-preview-je — [16].)*

### 🟦 Fázis B — Attachment & throttling
- [ ] Attachment `mediaUpload()` + privát bucket + signed-URL.
- [ ] Link-preview worker-oldalon SSRF-safe.
- [x] **`/notify` címzett-authz — KÉSZ** (2026-10-03): `canNotify` csak akkor enged
      (self / közös projekt / follow-él), nincs tetszőleges-címzett notification;
      pure döntés `server/security/notifyPolicy.js` + teszt. `messaging` rate-limit
      bekötve `/notify` + `/invite` elé.
- [ ] új-DM burst-limit (spam) — hátra.

### 🟦 Fázis C — Moderation
- [ ] Moderation-queue UI (moderator/admin) + műveletek + audit.
- [ ] Message-edit-audit + retention.

---

## 4. Kész, ha
- [ ] Blokkolt user nem tud DM-et küldeni, és nem jelenik meg a blokkoló feedjében/kommentjeiben.
- [ ] Reportált üzenet megjelenik a moderation-queue-ban; moderator művelete auditált.
- [ ] Attachment csak engedett típus/méret, privát + signed-URL.
- [ ] DM-spam burst `429`-et kap.

## 5. Teszt & ellenőrzés
- RLS-teszt: blokkolt→blokkoló DM `403`; report-insert csak saját kontextusra.
- `/verify`: block/mute/report end-to-end a kliensen.

## 6. Kockázat / függőség
- **Függőség:** [01](./01-worker-auth-policy.md), [02](./02-upload-security.md), [03](./03-rate-limiting.md), [04](./04-ssrf-protection.md), [05](./05-storage-security.md); moderation-szerep [rbac-roles-permissions].
- **E2E-encryption:** csak ha a threat-model indokolja — P2 ([16](./16-trust-safety-p2.md)), most stratégia-szinten dokumentálva.
