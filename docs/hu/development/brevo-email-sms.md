# 📧📲 Brevo — e-mail (SMTP) és SMS-OTP beállítás

> Ez a **működő** üzemeltetési leírás (ez a kanonikus Brevo-doksi); az alábbi
> kód-oldal **már megvan a repóban**, csak a fiók-oldali kulcsok kellenek.

A ReMix-fiók **kétféle csatornán** hozható létre:

| Csatorna | Aktiválás | Ki küldi |
|---|---|---|
| **E-mail** | megerősítő link | Supabase Auth → **Brevo SMTP** (dashboard-konfig, nincs kód) |
| **Telefon** | 6 jegyű **SMS-kód** | Supabase Auth → **Send SMS hook** → [`supabase/functions/send-sms`](../../../supabase/functions/send-sms/index.ts) → Brevo API |

---

## 1. Ami a repóban MÁR kész (kód)

| Elem | Fájl | Mit ad |
|---|---|---|
| Pure mag | [src/lib/phoneAuth.ts](../../../src/lib/phoneAuth.ts) | E.164-normalizálás (`+36`, `0036`, `06 30…`), országkód-allowlist, OTP-validálás, GSM-7 ékezet-mentesítés + SMS-szegmens-számítás, telefon-maszkolás — **22 teszt** |
| Edge Function | [supabase/functions/send-sms/index.ts](../../../supabase/functions/send-sms/index.ts) | `standardwebhooks` aláírás-ellenőrzés, Brevo `transactionalSMS`, országszűrő, 10 s timeout, beszédes kredit-kifogyás hiba |
| Auth-műveletek | [src/store/authStore.ts](../../../src/store/authStore.ts) | `signUpWithPhone` · `verifyPhoneOtp` · `resendPhoneOtp` |
| UI | [src/app/auth.tsx](../../../src/app/auth.tsx) | E-mail ↔ Telefon csatorna-váltó + SMS-kód lap (ellenőrzés / újraküldés / szám-csere), i18n en·hu·de |
| Lokális config | [supabase/config.toml](../../../supabase/config.toml) | `[auth.sms] enable_signup`, `test_otp` fix kód (nem fogy a kredit) |

---

## 2. Teendők a **Brevo** felületén

1. **SMTP-kulcs** (e-mailhez): SMTP & API → **SMTP** → Generate. A Brevo egy 6 jegyű
   kódot küld a fiók e-mail-címére. Kulcsnév: `expo-app-registration`.
   A kulcs `xsmtpsib-…` és **csak egyszer látszik**.
2. **API-kulcs** (SMS-hez): SMTP & API → API keys & MCP → **Generate API key**,
   név: `supabase-sms-hook` → `xkeysib-…`.
3. **SMS-kredit**: Usage and plan → SMS: Prepaid credits → **Buy credits**
   (legkisebb csomag 100 kredit). **Nincs ingyenes SMS.** Kapcsold be az alacsony
   kreditszint-figyelmeztetést.
4. **IP-szűrés**: az SMTP-kulcsokon hagyd **KIKAPCSOLVA** — a Supabase változó
   IP-ről küld, szűrés mellett a levelek elakadnának.

---

## 3. Teendők a **Supabase** felületén

### E-mail (SMTP)
Authentication → Emails → SMTP Settings → **Enable Custom SMTP**:

| Mező | Érték |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS); tartalék `465` (SSL) vagy `2525` |
| Username | `bb45c5001@smtp-brevo.com` |
| Password | az SMTP-kulcs (`xsmtpsib-…`) |
| Sender email | `h3nz3l@gmail.com` (ma csak ez ellenőrzött feladó) |
| Sender name | `ReMix` |

Majd Authentication → **Rate Limits** → emeld az e-mail limitet (egyedi SMTP mellett
alapból ~30/óra).

### SMS (hook + függvény)
1. Authentication → Sign In / Providers → **Phone**: bekapcsolni.
   (Szolgáltatót nem kell választani — a hook felülírja.)
2. Titkok + deploy:
   ```bash
   supabase secrets set \
     BREVO_API_KEY=xkeysib-... \
     SEND_SMS_HOOK_SECRET='v1,whsec_...' \
     BREVO_SMS_SENDER=ReMix \
     SMS_ALLOWED_DIAL_CODES=36
   supabase functions deploy send-sms --no-verify-jwt
   ```
3. Authentication → Hooks → **Send SMS hook** → HTTPS,
   URI: `https://<project-ref>.supabase.co/functions/v1/send-sms`,
   és a **Generate secret** értéke menjen a `SEND_SMS_HOOK_SECRET`-be.
4. 🛡️ Authentication → **Attack Protection** → CAPTCHA bekapcsolása
   (SMS-pumping ellen — lásd lent).

---

## 4. Limitek (fontos!)

**E-mail (Brevo Free):**
- **300 e-mail / nap**, a marketing és a tranzakciós levelek **együtt** számítanak.
  A limit naponta nullázódik; felette a küldés **leáll**.
- A free csomagon bekerülhet a **„Sent with Brevo"** lábléc (Starter ~$9–12/hó
  vagy előre fizetett kreditek távolítják el).
- ⚠️ **Gmail-feladó**: ingyenes levelezős domainről küldeni nem ajánlott — nincs saját
  DKIM/DMARC, a levelek könnyen **spambe** kerülnek. Éles indulás előtt vegyél fel
  saját domaint (Senders, Domains & IPs → Domains), a DKIM/DMARC rekordokkal, és
  válts `noreply@sajatdomain`-re.

**SMS:**
- Csak **előre fizetett kreditből** megy; ha elfogy, a küldés leáll (a függvény
  ilyenkor beszédes hibát naplóz: `SMS credit exhausted`).
- **160 karakter / SMS** — de **ékezettel (ő/ű) csak 70**, mert UCS-2-re vált a
  kódolás. Ezért az OTP-szöveg **szándékosan ékezet nélküli**
  (`ReMix aktivalo kod: 123456. Ne add meg senkinek!` = 48 karakter, 1 szegmens).
  Ezt a [phoneAuth.test.ts](../../../src/lib/phoneAuth.test.ts) teszt őrzi.
- Feladó-név: max **11 alfanumerikus** karakter.
- Supabase OTP rate-limit: ~30/óra (Authentication → Rate Limits); a kód hossza és
  lejárata a Phone provider alatt állítható.

**🛡️ SMS-pumping (valós pénzügyi kockázat):** botok drága országokba küldetnek
SMS-eket a kreditedből. Három védelem **már a kódban**:
1. `SMS_ALLOWED_DIAL_CODES=36` — a függvény **403**-at ad más országhívószámra;
2. a kliens is tiltja a submit-gombot (`isSendablePhone`);
3. `max_frequency = "60s"` a config.toml-ban.
Ezeken **túl** kapcsold be a **CAPTCHA**-t a Supabase Auth-ban.

---

## 5. Tesztelés

**Lokálisan** (nem fogy kredit): a `supabase/config.toml` `[auth.sms.test_otp]`
szakasza a `+36301234567` számhoz fix `123456` kódot ad.

**Élesben**: regisztrálj telefonnal, majd nézd meg a Brevo naplót
(Transactional → SMS → Logs) és a függvény logját (`supabase functions logs send-sms`).
A számot csak **maszkolva** naplózzuk, az OTP-t **soha**.
