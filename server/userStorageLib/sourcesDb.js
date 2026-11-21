// 🔌 Külső tárhely — a `user_storage_providers` tábla elérése (service_role).
const { adminClient } = require('../notify');

// ───────────────────────────────────────────────────────── DB-hozzáférés (SR)
async function loadUserSources(uid) {
  const sb = adminClient();
  if (!sb || !uid) {
    return [];
  }
  const { data, error } = await sb
    .from('user_storage_providers')
    .select('id, type, label, config, status, is_default')
    .eq('user_id', uid)
    .eq('status', 'connected')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

async function findUserSource(uid, sourceId) {
  return (await loadUserSources(uid)).find((s) => s.id === sourceId) ?? null;
}

async function saveSourceConfig(id, config) {
  const sb = adminClient();
  if (!sb) {
    return;
  }
  await sb.from('user_storage_providers').update({ config }).eq('id', id);
}

async function upsertProvider(uid, { type, label, config }) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('service_role nincs beállítva a workeren.');
  }
  const { data, error } = await sb
    .from('user_storage_providers')
    .insert({ user_id: uid, type, label, config, status: 'connected' })
    .select('id')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data.id;
}

async function disconnectSource(uid, sourceId) {
  const sb = adminClient();
  if (!sb) {
    throw new Error('service_role nincs beállítva a workeren.');
  }
  const { error } = await sb
    .from('user_storage_providers')
    .delete()
    .eq('user_id', uid)
    .eq('id', sourceId);
  if (error) {
    throw new Error(error.message);
  }
}

module.exports = { loadUserSources, findUserSource, saveSourceConfig, upsertProvider, disconnectSource };
