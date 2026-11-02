const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const { logCaught } = require('../lib/caught');
const { loginWithIdentifier } = require('../lib/loginIdentifier');
const { adminClient } = require('../notify');
const { rateLimit } = require('../security/rateLimit');

const router = express.Router();

// kérésenként külön kliens: a belépés sessionje nem keveredhet más kéréssel
const signIn = (email, password) =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email, password });

async function resolveEmail(identifier) {
  const { data, error } = await adminClient().rpc('resolve_login_email', { p_identifier: identifier });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// 🔐 Nyilvános, mert belépés előtt fut; szűk korlát IP-nként (lásd rateLimit: login)
router.post('/auth/login', express.json({ limit: '4kb' }), rateLimit('login'), async (req, res) => {
  if (!adminClient() || !process.env.SUPABASE_ANON_KEY) {
    res.status(503).json({ error: 'auth_unavailable' });
    return;
  }
  try {
    const { status, body } = await loginWithIdentifier(req.body ?? {}, { resolveEmail, signIn });
    res.status(status).json(body);
  } catch (caught) {
    logCaught('routes/auth.js', caught);
    res.status(503).json({ error: 'auth_unavailable' });
  }
});

module.exports = router;
