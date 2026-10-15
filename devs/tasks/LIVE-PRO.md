# 🔴 ReMix Live PRO — multistream + közös (unified) chat — fejlesztési terv

> Testvér-tervek: alap-Live a git-history [LIVE.md](https://github.com/)-je (A–F **KÉSZ**) · [VIDEO-STUDIO-PROD.md](./VIDEO-STUDIO-PROD.md) · [AUDIO-STUDIO-PROD.md](./AUDIO-STUDIO-PROD.md) · [04-social.md](./04-social.md) · [02-monetization.md](./02-monetization.md) · [PROD.md](./PROD.md) · index: [00-README.md](./00-README.md).
>
> **Mi ez?** Az OBS-szerű Live Studio (alap-Live A–F) **kész**: kompozitor + audio-mixer + feed-megosztás + **multistream RTMP-egress** (LiveKit Egress RoomComposite → RTMP fan-out, bizonyítottan) + VOD + hardening. Ez a terv a **következő réteg**: az alkotó a ReMixben indít élőt, **közben párhuzamosan közvetít külső platformokra (TikTok/YouTube/…)**, és **minden platform chatje EGY közös, időrendi felületen** jelenik meg, platform-jelöléssel — egységes moderációval.

> **📌 ÁLLAPOT (2026-10-13) — a terv KIINDULÁSA.** A „közvetítés több platformra" **nagyrészt már megvan** az alap-Live Fázis E-ben (custom-RTMP fan-out egressen át). Ami ÚJ és nyitott: a **platform-OAuth-konnektorok** (kulcs-pasztálás helyett auto-provision), a **közös chat** (külső platformok kommentfolyamának beszívása + normalizálása egy idővonalba), az **egységes moderáció + vissza-írás**, és a **platformonkénti statisztika**. Minden lenti `[ ]` = nyitott.

---

## 0. Kiindulás és cél

### 0.1 Mi KÉSZ már (az alap-Live-ból — erre építünk)
- **Multistream-közvetítés** — a kompozit adás szerveroldalon komponálódik (LiveKit Egress RoomComposite + web-layout template [server/egressLayout.html](../../server/egressLayout.html)) és **egy bemenetből RTMP-re fan-outol** több célra. A telefon csak EGYSZER tölt fel. Worker-endpoint: [server/liveEgress.js](../../server/liveEgress.js) (`startEgress`/`stopEgress`), route-ok [server/index.js](../../server/index.js) `/live/egress/start|stop`.
- **Cél-tár** — [20261004100000_live_destinations.sql](../../supabase/migrations/20261004100000_live_destinations.sql) + [src/lib/liveDestinations.ts](../../src/lib/liveDestinations.ts): a user RTMP-céljai (`platform`, `rtmp_url`, titkosított `stream_key`), owner-only RLS, a **kulcs sosem megy vissza a kliensre** ([server/liveCrypto.js](../../server/liveCrypto.js) AES-256-GCM).
- **ReMix saját chat** — [src/lib/live.ts](../../src/lib/live.ts) `joinLiveRoom` → Supabase-realtime broadcast: `chat`/`reaction` esemény + `presence` (nézőszám), be- és kimenő token-bucket rate-limit ([src/lib/liveRate.ts](../../src/lib/liveRate.ts)). Ez lesz a **közös chat alap-csatornája** (a külső üzeneteket EBBE a timeline-ba fűzzük).
- **Pro-kapu + költségkontroll** — a külső multistream `proOnly` + `MAX_CONCURRENT_EGRESS`/`MAX_EGRESS_MINUTES` ([server/liveEgress.js](../../server/liveEgress.js) `sweepStaleEgress`).

### 0.2 Mit AD HOZZÁ ez a terv (a felhasználó kérése)
> Az alkotó nálunk indít élőt, **közben TikTokra (és más platformra) is közvetít**, és a **platformok chatje egy közös felületen** jelenik meg.

A nézők a ReMixben így látnák (egy idővonal, platform-badge-dzsel):

```text
🔵 ReMix · @Anna     Sziasztok!
🎵 TikTok · @Peter   Hallasz minket?
▶️ YouTube · @Kata   Mekkora a mikrofon?
🔵 ReMix · @Anna     Igen, mehet a zene!
```

A streamelőnek **nem kell két chatablak között váltogatnia** — egy felület, egy moderáció.

### 0.3 A LEGFONTOSABB őszinte korlát (ezt a terv végig betartja)
A **közös chat technikailag megvalósítható**, de a platform-chatek beszívását a **hivatalos API-k és a hozzáférési jogosultságok korlátozzák**. Platformonként MÁS a helyzet:
- **ReMix** — teljesen a miénk, triviálisan integrálható (már megvan).
- **YouTube Live** — **van** hivatalos LiveChat API (`liveChatMessages.list`/`insert`), OAuth-fal; olvasás ÉS vissza-írás támogatott.
- **Twitch** — **van** hivatalos chat (IRC/EventSub), OAuth-fal; olvasás + vissza-írás + moderáció.
- **Facebook Live** — Graph API live-comments (webhook/edge), engedély-kapuzott (app-review), de hivatalos.
- **TikTok** — ⚠️ **NINCS** általánosan elérhető, minden fiókra építhető hivatalos LIVE-chat API. Nem hivatalos integrációk léteznek, de **törékenyek** és **fiók-/szolgáltatási kockázatot** jelentenek. **SOHA nem építünk arra, hogy automatikusan hozzáférünk minden TikTok-fiók LIVE-chatjéhez.**

**Vezérelv:** a közös chat **platform-adapteres** (plugin-szerű) — minden platform annyit ad, amennyit az API-ja hivatalosan enged; a UI őszintén jelzi, mi olvasható/írható/moderálható. Egy ReMix-üzenet **nem jelenik meg automatikusan** a TikTokon.

---

## 1. Architektúra-döntések

### 1.1 Két külön csatorna: videó-fan-out ≠ chat-beszívás
| Irány | Mi megy | Hogyan | Állapot |
| --- | --- | --- | --- |
| **ReMix → platformok (videó)** | a kompozit H.264/AAC stream | LiveKit Egress RoomComposite → RTMP fan-out (szerver) | ✅ KÉSZ (alap-Live E) |
| **platformok → ReMix (chat)** | kommentfolyam (olvasás) | **worker-oldali ingest-adapter** platformonként (OAuth polling / webhook / IRC) → normalizálás → realtime-broadcast | ⬜ ÚJ (ez a terv magja) |
| **ReMix → platform (vissza-írás, moderáció)** | host-üzenet, törlés/ban | worker → platform API (ha engedi) | ⬜ ÚJ |

**A chat-beszívás a WORKEREN fut, nem a telefonon** — OAuth-tokenek, polling, webhookok, IRC-kapcsolat a szerveren élnek (a telefon sosem birtokol platform-secretet, és nem tartja fenn N kapcsolatot). Ez konzisztens az alap-Live 0.1 elvével (*„egy feltöltés, szerver-oldali fan-out"*).

### 1.2 Normalizált chat-modell — egy idővonal, N forrás
```ts
// src/types/live.ts (ÚJ) — platform-független, a UI ezt rendezi egy listába
export type LiveChatOrigin = 'remix' | 'youtube' | 'tiktok' | 'twitch' | 'facebook';
export interface UnifiedChatMessage {
  id: string;                 // stabil, platform-prefixelt (pl. "yt:abc123")
  origin: LiveChatOrigin;     // badge + ikon ehhez
  authorName: string;
  authorId?: string;          // platform-belső (moderációhoz)
  text: string;
  ts: number;                 // ms, a KÖZÖS idővonal rendezéséhez
  badges?: string[];          // 'owner' | 'mod' | 'subscriber' | 'verified'
  canDelete?: boolean;        // ezen a platformon moderálható-e (API-függő)
}
```
A ReMix-saját `LiveChat` ([live.ts](../../src/lib/live.ts)) egy `origin: 'remix'`-es `UnifiedChatMessage`-re képződik; a külső üzeneteket a worker-adapter ebbe a formába hozza. Egy kliens-hook (`useUnifiedLiveChat(sessionId)`) a ReMix-realtime chatet **és** a worker-beszívott külső eventeket egy `ts`-rendezett listába fűzi.

### 1.3 Platform-adapter interfész (worker, plugin-szerű)
```js
// server/liveChat/<platform>.js (ÚJ) — minden adapter ezt valósítja meg
// start(session, conn)  → élő kommentfolyam feliratkozás; onMessage(UnifiedChatMessage)
// send(conn, text)      → vissza-írás a platformra (ha az API engedi; különben throw 'unsupported')
// moderate(conn, {msgId, action}) → delete/timeout/ban (ha engedi)
// capabilities()        → { read, write, moderate, viewerCount } booleanek → a UI ezt tükrözi
```
A `capabilities()` hajtja a UI-t: a TikTok-adapter tipikusan `{ read: <feltételes>, write: false, moderate: false }`-t ad → a felület nem ígér vissza-írást oda.

### 1.4 Kapcsolat-tár (OAuth) — a `live_destinations` mintájára
Új `live_chat_connections` tábla: `(user_id, platform, access_token, refresh_token, external_channel_id, scopes, expires_at, enabled)` — **owner-only RLS**, a tokenek **AES-256-GCM titkosítva** ([liveCrypto.js](../../server/liveCrypto.js) újrahasznosítás), a kliensnek **sosem** adjuk vissza (csak `connected: bool` + `capabilities`). A worker a `service_role`-lal olvassa ingest-kor. (A videó-`live_destinations` és a chat-`live_chat_connections` **külön** — egy platform lehet csak-videó vagy csak-chat kapcsolt.)

### 1.5 A kulcs-döntés: mobil vs. desktop (lásd §4.1)
Az alap-Live **mobilon bizonyítottan megy** (egress fan-out → a telefon egyszer tölt fel). Ezért a külön „desktop ReMix Studio a stabilitásért" **nem előfeltétel** — a telefon-fan-out aggálya már megoldott az egress-architektúrával. **Javaslat:** a mobil marad a capture + go-live kliens; a **közös chat szerver-beszívott**, ezért eszköz-független → ugyanúgy látszik mobilon ÉS egy opcionális **web „control room" második-képernyőn** (moderáláshoz kényelmesebb). Ezt §4.1 rögzíti eldöntendőként, a javaslat: **mobil-first, web-control-room opcionális v2+**.

---

## 2. Fázisok

> Jelölés: `[ ]` nyitott · státusz-tag a §1 (00-README) taxonómia szerint. A fázisok a felhasználó v1/v2/v3 bontását követik, az alap-Live A–F **fölé** (G-től).

### 🟩 Fázis G — v1: ReMix LIVE + TikTokra (és platformokra) továbbított stream + ReMix-chat mint közös-chat-váz
Cél: ami lényegében megvan, azt **összehúzni egy termékeélménnyé** + a közös-chat UI-vázat felrakni (még csak ReMix-forrással), hogy a külső adapterek beköthetők legyenek.

- [ ] 🟡 **Multistream-UX kerek** — a Live Studio cél-chipjei (YouTube/TikTok/Twitch/Facebook/custom) + RTMP-URL+kulcs-bevitel már vannak; véglegesíteni az „adásba megy ide is" visszajelzést (egress-státusz per cél: él / hibázik / újracsatlakozik) a [src/app/live/studio/[id].tsx](../../src/app/live/studio/%5Bid%5D.tsx)-ben.
- [ ] 🖼️ **Unified-chat UI-váz** — a nézői/host chat-panel ([src/components/live/](../../src/components/live/)) átáll `UnifiedChatMessage[]`-re: platform-badge (🔵/🎵/▶️/💜/🔵f), szerző, szöveg, idő. Egyelőre csak `origin: 'remix'` folyik bele → semmit nem ígér, de a kontackt kész.
- [ ] **`useUnifiedLiveChat(sessionId)` hook** — a [live.ts](../../src/lib/live.ts) `onChat`-ját `UnifiedChatMessage`-re mappeli; a külső forrásoknak már most helyet hagy (üres merge-ág). Pure-mappelő + teszt (`live.test.ts` mintára).
- [ ] **Modell** — `UnifiedChatMessage` + `LiveChatOrigin` a [src/types/live.ts](../../src/types/live.ts)-be (additív).

**Kész, ha:** a Studióból egyszerre megy a ReMix-feed-live + ≥1 külső RTMP-cél (pl. TikTok custom-kulccsal, ahol a user adja a kulcsot), és a chat-panel a `UnifiedChatMessage` modellt rendereli badge-dzsel; `npm run audit` zöld. **(A videó-oldal e2e-je = alap-Live E — már bizonyított.)**

### 🟦 Fázis H — v2: közös chat — külső platformok kommentfolyamának beszívása
Cél: a külső platformok kommentjei **a hivatalos API-k által megengedett mértékben** beömlenek a közös idővonalba. **Platformonként külön, őszinte capability-vel.**

- [ ] **Adapter-váz** [server/liveChat/index.js](../../server/) (ÚJ) — a §1.3 interfész + regiszter; az ingest egy élő session-höz indul (host „connect platform" után) és a normalizált üzenetet a `live:{sessionId}` realtime-csatorna `unified-chat` eventjére publikálja (a nézők + host EGY timeline-t látnak).
- [ ] **Kapcsolat-tár** `live_chat_connections` migráció (§1.4) + OAuth-callback route-ok [server/index.js](../../server/index.js) `/live/chat/connect/:platform` (env-gated kliens-ID/secret, mint a többi OAuth a [storage-quota-and-providers] mintában).
- [ ] 🔌 **YouTube-adapter (ELSŐ — hivatalos, legtisztább)** — OAuth → a futó `liveBroadcast` `liveChatId`-ja → `liveChatMessages.list` polling (a `pollingIntervalMillis`-t az API adja) → `UnifiedChatMessage`. Olvasás **és** `authorChannelId` moderációhoz.
- [ ] 🔌 **Twitch-adapter** — OAuth → EventSub `channel.chat.message` (vagy IRC) → normalizálás; badge-ek (sub/mod).
- [ ] 🔌 **Facebook-adapter** — Graph API Live Video comments (webhook preferált), engedély-kapuzott (app-review go-live dep).
- [ ] ⚠️ **TikTok-adapter — policy-kapuzott, feltételes** — **CSAK** akkor aktiváljuk egy fiókra, ha arra **megbízhatóan, engedélyezetten** elérhető a LIVE-kommentfolyam (TikTok LIVE-jogosultság / hivatalos adatforrás). Nincs általános „minden TikTok-fiók"-feltételezés; nem hivatalos scraper-út **nem** kerül be (fiók-/szolgáltatási kockázat). A `capabilities().read` futásidőben dől el; ha nincs forrás → a UI „TikTok-chat nem elérhető ehhez a fiókhoz"-t ír, a videó-fan-out attól még megy.
- [ ] **Capability-tükrözés a UI-ban** — a chat-fejléc platformonként mutatja: *olvasható ✓ / írható ✓ / moderálható ✓* (vagy szürke). Soha nem ígér többet, mint amit az adapter `capabilities()`-e ad.

**Kész, ha:** egy YouTube-live (teszt-csatorna) kommentjei élőben megjelennek a ReMix közös chatjében `▶️ YouTube` badge-dzsel, a ReMix-sajátokkal egy idővonalban; a tokenek titkosítva, sosem szivárognak a kliensre; `npm run audit` + worker-teszt (`server/liveChat/*.test.js`) zöld.

### 🟪 Fázis I — v3: egységes moderáció + vissza-írás + chatparancsok + statisztika
Cél: a közös chat **kétirányú és moderálható** — a platform-API-k engedte határokon belül, őszintén.

- [ ] **Vissza-írás** `/live/chat/send` (ÚJ, [server/index.js](../../server/index.js)) — a host a ReMixből ír, `targetPlatform`-mal: a worker a megfelelő adapter `send()`-jével továbbítja (YouTube `liveChatMessages.insert`, Twitch send). **Ahova nem lehet (TikTok) — a UI letiltja a cél-választót.** Egy ReMix-üzenet alap-esetben a ReMix-chatben marad; külső platformra CSAK explicit cél-választással + ha az API engedi.
- [ ] **Egységes moderáció** `/live/chat/moderate` — törlés/timeout/ban a `UnifiedChatMessage.origin` + `authorId` alapján a platform `moderate()`-jén át (YouTube delete/ban, Twitch timeout/ban; ReMix: a meglévő owner-moderáció mintája a [social-feed]-ből). A ReMix-oldali törlés azonnali; a külső a platform-API latenciájával.
- [ ] **Chatparancsok** — `!` parancs-keret a közös chatben (pl. `!shoutout`, `!link`), platform-független feldolgozás a worker-adapterek fölött.
- [ ] 📊 **Platformonkénti statisztika** — élő nézőszám + chat-ráta per platform (ReMix = presence; YouTube = `liveBroadcast` concurrentViewers; Twitch = Helix streams) egy közös „Live stats" panelben; a `capabilities().viewerCount` szerint. Illeszkedik az [analytics-core]-hoz.
- [ ] ⚖️ **Flood/abúzus-védelem a beszívásra** — a bejövő külső chat is a [liveRate.ts](../../src/lib/liveRate.ts) globális limiter mögött; platformonkénti throttle, hogy egy spam-platform ne nyomja el a többit.

**Kész, ha:** a host a ReMixből töröl egy YouTube-kommentet és visszaír a YouTube-chatre, mindkettő átmegy; a stats-panel platformonként mutat nézőszámot; `npm run audit` + worker-teszt zöld.

### 🟥 Fázis J — hardening + production + go-live
Cél: prod-képes közös-chat-infra, biztonság, költség- és policy-megfelelés.

- [ ] 🔐 **Token-biztonság** — OAuth-tokenek AES-GCM titkosítva nyugalomban ([liveCrypto.js](../../server/liveCrypto.js)), refresh a workeren, kliensnek csak `connected`/`capabilities`. `live_chat_connections` RLS owner-only (mint `live_destinations`).
- [ ] 💰 **Pro-kapu + kvóta** — a közös chat (külső beszívás) a `proOnly` mögött (a külső multistream úgyis Pro); max párhuzamos ingest-kapcsolat/user + max-hossz (az egress-`sweepStaleEgress` mintára), mert a polling/webhook-infra valós szerver-erőforrás. Illeszkedik a [usage-metering-vertical]-hoz.
- [ ] ⚠️ **Policy-megfelelés dokumentálva** — platformonként a felhasznált API + scope + engedély-státusz egy `DOCS`-táblában; TikTok őszinte korlát-jelzés a UI-ban és a store-leírásban (nem ígérünk „egy-kattintásos TikTok közös chatet"). Facebook/YouTube app-review mint go-live dep.
- [ ] 🧪 **E2e-verify** — valós YouTube-live + Twitch teszt-csatornával végig: connect → beszívás → vissza-írás → moderáció → disconnect; token-rotáció ellenőrzés.
- [ ] **Újracsatlakozás/robusztusság** — adapter-szintű reconnect (IRC/webhook drop, token-expiry), a közös timeline nem törik meg egy platform kiesésekor (a többi folyik, a UI jelzi a kiesést).

**Kész, ha:** prod-creds-szel egy valós YouTube+Twitch közös chat végigmegy (olvas/ír/moderál), a tokenek titkosítva, a Pro-kapu + kvóta aktív, a policy-korlátok dokumentáltak és a UI-ban őszintén jelezve; a TikTok-videó-fan-out megy, a TikTok-chat állapota a tényleges jogosultságtól függően korrekt.

---

## 3. Platform-mátrix (őszinte képességek)

| Platform | Videó (RTMP fan-out) | Chat olvasás | Vissza-írás | Moderáció | Nézőszám | Megjegyzés |
| --- | --- | --- | --- | --- | --- | --- |
| **🔵 ReMix** | — (natív feed) | ✅ | ✅ | ✅ | ✅ (presence) | teljesen a miénk, kész |
| **▶️ YouTube** | ✅ (OAuth v. kulcs) | ✅ LiveChat API | ✅ `insert` | ✅ delete/ban | ✅ concurrentViewers | legtisztább külső út |
| **💜 Twitch** | ✅ | ✅ IRC/EventSub | ✅ | ✅ timeout/ban | ✅ Helix | hivatalos, robusztus |
| **🔵 Facebook** | ✅ (Graph Live) | 🟡 Graph comments | 🟡 | 🟡 | 🟡 | app-review engedély-kapu |
| **🎵 TikTok** | 🟡 custom-RTMP (jogosultság-függő) | ⚠️ **feltételes** | ❌ | ❌ | ⚠️ | **nincs általános hivatalos LIVE-chat API**; csak engedélyezett adatforrással, fiókonként |
| **custom RTMP** | ✅ | ❌ (nincs chat-modell) | ❌ | ❌ | ❌ | tiszta videó-ingest-cél |

> A mátrix a **UI igazság-forrása**: a felület platformonként pontosan ennyit ajánl fel, az adapter futásidejű `capabilities()`-e szerint.

---

## 4. Kockázatok és nyitott kérdések

### 4.1 ⭐ A ELDÖNTENDŐ architektúra-kérdés (a felhasználó kérdése)
**Legyen-e a mobil-appból is párhuzamos LIVE TikTokra, vagy v1-ben elég a (desktop) ReMix Studio?**

- **Tényhelyzet:** az alap-Live egress-fan-outja miatt a *„ne a telefon küldjön külön-külön két platformra"* aggály **már megoldott** — a telefon **egyszer** tölt fel LiveKitbe, a fan-out szerveroldali. Mobilon **bizonyítottan** megy (lásd [[live-video-livekit]]).
- **Javaslat (ez a terv alapértelmezése):** **mobil-first** — a telefon marad a capture + go-live kliens; a **közös chat szerver-beszívott**, ezért eszköz-független. Egy **web „control room" (második-képernyő moderáció)** opcionális v2+ bővítés, nem előfeltétel.
- **Amit a döntés befolyásol:** ha mégis desktop-first kellene, az egy ÚJ web-capture/stream-kliens (nagyobb scope); a chat-adapter-réteg (H–I) viszont **mindkét esetben ugyanaz** (worker-oldali), tehát a chat-munka nem blokkolt a döntésig. → **A G–J fázisok elkezdhetők a döntés előtt is.**

### 4.2 Egyéb kockázatok
- **TikTok-törékenység** — nem hivatalos chat-forrás fiók-/szolgáltatási kockázat → kizárva; a termék sosem ígér TikTok közös chatet alapértelmezésként. A videó-fan-out is a TikTok tényleges streamelési jogosultságától függ.
- **API-rate-limit / polling-költség** — YouTube LiveChat polling + Facebook webhook-infra szerver-erőforrás → Pro + kvóta + ingest-reconnect.
- **App-review késleltetés** — YouTube/Facebook/Twitch éles OAuth-scope-okhoz platform-review kell → go-live dependency, env-gated addig.
- **Idővonal-rendezés** — a platformok `ts`-e eltérhet (szerver-idő vs. kliens) → a worker normalizál egy közös órára; kis jitter várható.
- **Moderáció-latencia** — a külső törlés a platform-API sebességével megy; a UI „függőben" állapotot mutat, nem hazudik azonnali törlést.

---

## 5. Végrehajtási sorrend (függőségek)

```text
alap-Live A–F (KÉSZ)
      │
      ▼
G (v1: multistream-UX kerek + unified-chat UI-váz + modell)  ← azonnal, meglévőre épül
      │
      ▼
H (v2: külső chat-beszívás — YouTube ▶ Twitch ▶ Facebook ▶ TikTok-feltételes)
      │
      ▼
I (v3: vissza-írás + egységes moderáció + parancsok + stats)
      │
      ▼
J (hardening + prod + policy + e2e)
```

**Sprint-javaslat:** **G** egy kis MVP-kör (a meglévő multistream + egy közös-chat-váz — demózható azonnal, csak ReMix-chat). **H** a valódi érték (YouTube elsőként, a legtisztább API), platformonként szállítva. **I** teszi kétirányúvá + moderálhatóvá. **J** a prod + őszinte policy. A **§4.1 döntés** a chat-munkát NEM blokkolja (az worker-oldali, eszköz-független).

---

## 6. Vezérelvek (minden fázisra)

- **Egy idővonal, N adapter** — a `UnifiedChatMessage` a közös igazság; minden platform egy plugin-adapter, a `capabilities()`-e hajtja a UI-t. Nincs platform-specifikus elágazás a UI-ban.
- **Őszinte képességek** — a felület SOHA nem ígér többet, mint amit az adott platform API-ja hivatalosan enged (főleg TikTok). Egy ReMix-üzenet nem jelenik meg automatikusan a TikTokon.
- **A chat-beszívás szerver-oldali** — OAuth-token, polling, webhook, IRC a workeren; a kliens sosem birtokol platform-secretet (konzisztens az alap-Live „egy feltöltés, szerver-fan-out" elvével).
- **A kliens sosem authoritatív** — token, Pro-státusz, ingest-indítás, vissza-írás, moderáció mind server-side + ownership-verify (mint `/live/token`, `/live/egress/*`).
- **Nincs regresszió a free-rétegen** — a ReMix-feed-live + ReMix-saját chat ingyen marad; a külső multistream + külső közös-chat Pro (valós szerver-költség).
- **Bizonyíték-alapú „Kész"** — minden fázisnak futtatható/e2e elfogadási kritériuma (mint az alap-Live kamera-/egress-e2e-nél).
