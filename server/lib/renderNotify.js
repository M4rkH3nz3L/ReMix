// 🔔 Kell-e értesíteni a job gazdáját? A belső render (hangosság-mérés, album-szám) a kliens
// saját lépése, a felhasználó benne van a folyamatban — arról nem jön „Kész a renderelés”.
// Csak az értesítésre hat, a kvóta-könyvelésre nem (az nem bízható a kliens jelzésére).
function shouldNotifyOwner(jobData) {
  const d = jobData || {};
  return !!d.userId && d.settings?.notify !== false;
}

module.exports = { shouldNotifyOwner };
