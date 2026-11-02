/**
 * 🔐 Belépés felhasználónévvel vagy telefonnal (PRO-SOCIAL S2). Az azonosítóból az e-mailt a szerver
 * oldja fel, és soha nem adja ki: ismeretlen azonosító és rossz jelszó ugyanazt a választ kapja.
 */
const INVALID = { status: 401, body: { error: 'invalid_credentials' } };

async function loginWithIdentifier({ identifier, password }, { resolveEmail, signIn }) {
  const id = typeof identifier === 'string' ? identifier.trim() : '';
  if (!id || id.length > 200 || typeof password !== 'string' || !password || password.length > 200) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  const email = await resolveEmail(id);
  if (!email) {
    return INVALID;
  }
  const { data, error } = await signIn(email, password);
  if (error || !data?.session) {
    // a megerősítetlen fiók üzenete hasznos, és csak helyes jelszóval jön
    return error?.code === 'email_not_confirmed' ? { status: 403, body: { error: 'email_not_confirmed' } } : INVALID;
  }
  return { status: 200, body: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } };
}

module.exports = { loginWithIdentifier };
