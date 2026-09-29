/**
 * 📲 Supabase "Send SMS" auth hook → Brevo transactional SMS.
 *
 * A Supabase-nek nincs beépített Brevo SMS-szolgáltatója, ezért a telefonos
 * regisztráció/belépés OTP-jét ez az Edge Function küldi ki. A Supabase Auth
 * HTTPS-hookként hívja (Authentication → Hooks → Send SMS hook), a kérést
 * `standardwebhooks` aláírás hitelesíti.
 *
 * ⚠️ RUNTIME: ez **Deno** (nem az RN-app). Ezért a `src/lib/phoneAuth.ts` mag NEM
 * importálható ide (más modul-feloldás), a szükséges szabályok szándékosan
 * DUPLIKÁLVA vannak alább — a mag oldalán tesztek őrzik ugyanezt a viselkedést
 * (`src/lib/phoneAuth.test.ts`). Ha az egyiket módosítod, a másikat is nézd meg.
 * A `supabase/functions/**` kizárva a repo `tsc`/`eslint` alól (lásd tsconfig).
 *
 * Telepítés:
 *   supabase secrets set BREVO_API_KEY=xkeysib-... \
 *     SEND_SMS_HOOK_SECRET='v1,whsec_...' BREVO_SMS_SENDER=ReMix \
 *     SMS_ALLOWED_DIAL_CODES=36
 *   supabase functions deploy send-sms --no-verify-jwt
 * Hook URL: https://<project-ref>.supabase.co/functions/v1/send-sms
 */
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const BREVO_SMS_ENDPOINT = 'https://api.brevo.com/v3/transactionalSMS/sms';
/** Brevo: a feladó-név max 11 alfanumerikus karakter. */
const SMS_SENDER_MAX = 11;
/** GSM-7 SMS hossza (ékezettel UCS-2 lenne → csak 70). */
const SMS_GSM7_LIMIT = 160;
/** A Brevo-hívás timeoutja — a hook ne akadjon be. */
const BREVO_TIMEOUT_MS = 10_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Supabase auth-hook hibaformátum (ezt a Auth megjeleníti/naplózza). */
const hookError = (httpCode: number, message: string) =>
  json({ error: { http_code: httpCode, message } }, httpCode);

/** Ékezet-eltávolítás + ASCII-szűkítés → az SMS 160 karakteres maradhat. */
function toGsm7(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

/** Brevo feladó-név: alfanumerikus, max 11 karakter. */
function normalizeSender(raw: string | undefined): string {
  const cleaned = toGsm7(raw ?? '').replace(/[^A-Za-z0-9]/g, '');
  return (cleaned || 'ReMix').slice(0, SMS_SENDER_MAX);
}

/** Az OTP-SMS szövege — ÉKEZET NÉLKÜL, garantáltan egy szegmens. */
function otpMessage(otp: string, brand: string): string {
  const build = (b: string) => `${b} aktivalo kod: ${otp}. Ne add meg senkinek!`;
  let text = build(brand);
  if (text.length > SMS_GSM7_LIMIT) {
    const overflow = text.length - SMS_GSM7_LIMIT;
    text = build(brand.slice(0, Math.max(1, brand.length - overflow)));
  }
  return text;
}

/**
 * 🛡️ SMS-pumping védelem: csak az engedélyezett országkódokra küldünk. A kredit
 * VALÓDI PÉNZ — bot-regisztrációk különben elégetnék. `SMS_ALLOWED_DIAL_CODES`
 * vesszős lista (pl. `36,43`); üres/`*` = minden ország (kifejezett feloldás).
 */
function isAllowedRecipient(digits: string, allowedCsv: string | undefined): boolean {
  const raw = (allowedCsv ?? '36').trim();
  if (raw === '' || raw === '*') {
    return true;
  }
  const allowed = raw
    .split(',')
    .map((c) => c.replace(/\D/g, ''))
    .filter(Boolean);
  return allowed.some((code) => digits.startsWith(code));
}

interface SmsHookPayload {
  user: { phone: string };
  sms: { otp: string };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return hookError(405, 'Method not allowed');
  }

  // ── env-guard: hiányzó titok esetén NE próbáljunk küldeni ────────────────
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const hookSecretRaw = Deno.env.get('SEND_SMS_HOOK_SECRET');
  if (!apiKey || !hookSecretRaw) {
    console.error('send-sms: missing BREVO_API_KEY or SEND_SMS_HOOK_SECRET');
    return hookError(500, 'SMS provider is not configured');
  }
  const sender = normalizeSender(Deno.env.get('BREVO_SMS_SENDER'));

  // ── aláírás-hitelesítés (standardwebhooks) ───────────────────────────────
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  let data: SmsHookPayload;
  try {
    const secret = hookSecretRaw.replace('v1,whsec_', '');
    data = new Webhook(secret).verify(payload, headers) as SmsHookPayload;
  } catch {
    return hookError(401, 'Invalid signature');
  }

  const digits = (data?.user?.phone ?? '').replace(/\D/g, '');
  const otp = (data?.sms?.otp ?? '').trim();
  if (!digits || !otp) {
    return hookError(400, 'Missing phone or otp');
  }

  if (!isAllowedRecipient(digits, Deno.env.get('SMS_ALLOWED_DIAL_CODES'))) {
    // a számot csak maszkolva naplózzuk (PII), az OTP-t SOHA
    console.warn(`send-sms: blocked dial code for +${digits.slice(0, 4)}***`);
    return hookError(403, 'This country is not supported for SMS sign-up');
  }

  // ── Brevo transactional SMS ──────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const res = await fetch(BREVO_SMS_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        recipient: digits,
        content: otpMessage(otp, sender),
        type: 'transactional',
        tag: 'signup-otp',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`send-sms: Brevo ${res.status} ${detail.slice(0, 300)}`);
      // 402 = elfogyott az SMS-kredit → beszédes üzenet a naplóba/usernek
      const message =
        res.status === 402
          ? 'SMS credit exhausted — top up Brevo prepaid credits'
          : `SMS provider error (${res.status})`;
      return hookError(500, message);
    }
    return json({});
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    console.error(`send-sms: ${aborted ? 'Brevo timeout' : String(err)}`);
    return hookError(504, aborted ? 'SMS provider timeout' : 'SMS send failed');
  } finally {
    clearTimeout(timer);
  }
});
