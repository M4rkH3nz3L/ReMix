// 🌱 Teszt-userek létrehozása a (prod) Supabase auth-ban — SIGNUP úton.
//
// A prod service_role kulcs nem elérhető lokálisan, ezért az admin-API helyett a
// NORMÁL signUp-ot használjuk a prod ANON kulccsal (EXPO_PUBLIC_SUPABASE_URL +
// EXPO_PUBLIC_SUPABASE_ANON_KEY). A profilt a signup-trigger (handle_new_user) hozza
// a user_metadata-ból. A jelszó 12+ karakter (prod password-policy).
//
// Futtatás a server/ könyvtárból a PROD env-fájllal:
//   node --env-file=../.env.production seed-test-users.js
// ⚠️ PROD-ÍRÁS: valódi auth-fiókokat hoz létre. Idempotens: a már létező e-mailt
// kihagyja. Ha a prod email-confirmation BE van kapcsolva, a user létrejön, de
// megerősítésig nem léphet be — a script ezt jelzi.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const ANON = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
if (!URL || !ANON) {
  console.error('❌ EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY hiányzik (futtasd --env-file=../.env.production-nel).');
  process.exit(1);
}

// A users.json végén nem-JSON jegyzet is lehet → csak az ELSŐ top-level {...}-t parse-oljuk
function parseFirstJsonObject(raw) {
  const start = raw.indexOf('{');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error('Nem találtam érvényes JSON-objektumot a users.json-ban.');
}

const spec = parseFirstJsonObject(fs.readFileSync(path.join(__dirname, '..', 'users.json'), 'utf8'));
const defaultPassword = spec.password || 'Teszt1234!ReMix';
const CONSENT_VERSION = '1';

async function main() {
  console.log(`🌱 Seed (signUp) → ${URL} (${spec.users.length} user)`);
  for (const u of spec.users) {
    // friss, perzisztálás nélküli kliens userenként (ne keveredjen a session)
    const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.auth.signUp({
      email: u.email,
      password: u.password || defaultPassword,
      options: {
        data: {
          full_name: u.fullName,
          username: u.username,
          phone: u.phone,
          birthday: u.birthday,
          country: u.country,
          city: u.city,
          consent_version: CONSENT_VERSION,
        },
      },
    });
    if (error) {
      if (/already been registered|already exists|duplicate/i.test(error.message)) {
        console.log(`  ⏭️  ${u.email} — már létezik, kihagyva`);
      } else {
        console.error(`  ❌ ${u.email} — ${error.message}`);
      }
      continue;
    }
    const confirmed = !!data.session; // van azonnali session → belépésre kész
    console.log(
      `  ✅ ${u.email} (${u.username}) → ${data.user?.id}` +
        (confirmed ? ' — beléptethető' : ' — ⚠️ e-mail-megerősítésre vár (confirmations ON)'),
    );
  }
  console.log('Kész.');
}

main().catch((e) => {
  console.error('Seed hiba:', e.message);
  process.exit(1);
});
