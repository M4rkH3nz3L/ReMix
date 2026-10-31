// 🔐 I46: a kliens-adott `projectId` csak rendezési szempont, jogosultságot NEM ad — a
// kulcs a hitelesített felhasználó saját prefixe alatt van, így idegen projekt
// tár-prefixébe nem lehet írni (akkor sem, ha valaki kitalálja a projekt-azonosítót).
function ownedMediaKey(uid, projectId, rest) {
  const owner = String(uid || 'anon').replace(/[^\w-]/g, '').slice(0, 64) || 'anon';
  const project = String(projectId || '').replace(/[^\w-]/g, '').slice(0, 64);
  return project ? `u/${owner}/${project}/${rest}` : `u/${owner}/${rest}`;
}

module.exports = { ownedMediaKey };
