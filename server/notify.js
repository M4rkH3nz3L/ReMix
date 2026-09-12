// 🔔 Értesítés-küldés a workerből — service_role-lal (megkerüli az RLS-t), így
// SELF és CROSS-USER (team-working: komment/meghívó/mention) is mehet.
//   1) beszúr a `notifications` sorba → a Supabase Realtime kézbesíti a kliensnek
//   2) ha a cél-usernek van `push_token`-je → Expo push (háttérben is szól)
//
// Env (lásd .env.example): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Ezek nélkül
// a /notify 503-at ad (a realtime self-insert a kliensből enélkül is megy).
const { createClient } = require('@supabase/supabase-js');
const { Expo } = require('expo-server-sdk');

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const TYPES = new Set(['info', 'comment', 'invite', 'mention', 'render', 'system']);

let admin = null;
function adminClient() {
  if (admin) {
    return admin;
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return null;
  }
  admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Be van-e kötve a service_role (menni fog-e a /notify). */
function notifyAvailable() {
  return !!adminClient();
}

const expo = new Expo();

/** Remote push a user ÖSSZES eszközére (amelyiknek van érvényes tokenje). */
async function sendPushToUser(sb, userId, row) {
  const { data: devices } = await sb
    .from('user_devices')
    .select('push_token')
    .eq('user_id', userId)
    .not('push_token', 'is', null);
  const tokens = (devices || []).map((d) => d.push_token).filter((t) => Expo.isExpoPushToken(t));
  if (!tokens.length) {
    return { sent: 0 };
  }
  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title: row.title,
    body: row.body || undefined,
    data: { route: row.route || null },
  }));
  let sent = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    await expo.sendPushNotificationsAsync(chunk);
    sent += chunk.length;
  }
  return { sent };
}

/**
 * Egy értesítés kézbesítése: DB-sor (realtime) + best-effort remote push.
 * `input`: { userId, type?, title, body?, route?, data? }
 */
async function sendNotification(input) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nincs beállítva a workeren.');
  }
  const userId = String(input?.userId || '').trim();
  const title = String(input?.title || '').trim();
  if (!userId || !title) {
    throw new Error('userId és title kötelező.');
  }
  const row = {
    user_id: userId,
    type: TYPES.has(input.type) ? input.type : 'info',
    title: title.slice(0, 200),
    body: input?.body ? String(input.body).slice(0, 2000) : null,
    route: input?.route ? String(input.route).slice(0, 500) : null,
    data: input?.data && typeof input.data === 'object' ? input.data : null,
  };

  const { data: inserted, error } = await sb
    .from('notifications')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    throw new Error(error.message);
  }

  const push = await sendPushToUser(sb, userId, row).catch((e) => ({ sent: 0, error: e.message }));
  return { id: inserted.id, push };
}

module.exports = { notifyAvailable, sendNotification };
