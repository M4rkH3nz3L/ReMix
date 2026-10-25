const fs = require('fs');
const os = require('os');
const path = require('path');

const { BugStore } = require('./lib/bugStore');
const { LoadShedder, TokenCache } = require('./lib/bugGuards');
const { sanitizeReport } = require('./lib/bugReport');

/**
 * 🐞 Hiba-tár + terhelés-védelmek: aszinkron, memória-indexes tár (párhuzamos
 * beolvasztás nem veszít számlálót, a fejlesztő státusza nem íródik felül),
 * token-cache (nincs jelentésenkénti Supabase-hívás), terhelés-levezetés.
 */

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remix-bugs-'));
}

function report(partial = {}) {
  return sanitizeReport({
    name: 'TypeError',
    message: 'Cannot read property uri',
    stack: 'TypeError\n    at buildRenderPlan (address at index.android.bundle:1:345)',
    platform: 'android',
    ...partial,
  });
}

describe('BugStore', () => {
  it('első előfordulás → új fájl; ismétlés → ugyanaz a fájl, nő a számláló', async () => {
    const dir = tmpDir();
    const store = new BugStore({ dir });
    const a = await store.ingest(report({ qid: 'aaaa0001' }), null);
    const b = await store.ingest(report({ qid: 'aaaa0002' }), null);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(b.count).toBe(2);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('50 PÁRHUZAMOS beolvasztás → a számláló pontosan 50 (nincs elveszett frissítés)', async () => {
    const dir = tmpDir();
    const store = new BugStore({ dir });
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.ingest(report({ qid: `par${String(i).padStart(4, '0')}` }), null)),
    );
    const [file] = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).count).toBe(50);
    expect(fs.readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
  });

  it('újraindítás után az index a lemezről épül (a meglévő fájlhoz ír tovább)', async () => {
    const dir = tmpDir();
    await new BugStore({ dir }).ingest(report({ qid: 'r1aaaaaa' }), null);
    const restarted = new BugStore({ dir });
    const r = await restarted.ingest(report({ qid: 'r2bbbbbb' }), null);
    expect(r.count).toBe(2);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('a fejlesztő által „fixed"-re jelölt fájlt nem írjuk felül — az új előfordulás regressed', async () => {
    const dir = tmpDir();
    const store = new BugStore({ dir });
    const first = await store.ingest(report({ qid: 'f1aaaaaa' }), null);
    const file = path.join(dir, first.file);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...doc, status: 'fixed', notes: 'javítva: abc123' }));
    const again = await store.ingest(report({ qid: 'f2bbbbbb' }), null);
    expect(again.status).toBe('regressed');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).notes).toBe('javítva: abc123');
  });

  it('duplikátum (azonos qid) nem ír; fájlszám-plafon fölött új hiba eldobva', async () => {
    const dir = tmpDir();
    const store = new BugStore({ dir, maxFiles: 1 });
    await store.ingest(report({ qid: 'd1aaaaaa' }), null);
    const dup = await store.ingest(report({ qid: 'd1aaaaaa' }), null);
    expect(dup.duplicate).toBe(true);
    const other = await store.ingest(report({ message: 'egészen más hiba', qid: 'd2bbbbbb' }), null);
    expect(other.dropped).toBe(true);
    // a meglévő hiba számlálója a plafon fölött is nő
    expect((await store.ingest(report({ qid: 'd3cccccc' }), null)).count).toBe(2);
  });
});

describe('TokenCache', () => {
  it('a feloldott user-id TTL-ig cache-ben; a hibás token (null) is', () => {
    const c = new TokenCache({ ttlMs: 1000 });
    expect(c.get('tok', 0)).toBeUndefined();
    c.set('tok', 'user-1', 0);
    c.set('rossz', null, 0);
    expect(c.get('tok', 999)).toBe('user-1');
    expect(c.get('rossz', 500)).toBeNull();
    expect(c.get('tok', 1000)).toBeUndefined(); // lejárt
  });

  it('méret-plafon: a legrégebbi esik ki; a nyers token nincs tárolva', () => {
    const c = new TokenCache({ max: 2 });
    c.set('a', '1', 0);
    c.set('b', '2', 0);
    c.set('c', '3', 0);
    expect(c.get('a', 1)).toBeUndefined();
    expect(c.get('c', 1)).toBe('3');
    expect([...c.map.keys()].every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true);
  });
});

describe('LoadShedder', () => {
  it('a percenkénti plafonig enged, fölötte Retry-After-rel elutasít, új ablakban újra enged', () => {
    const s = new LoadShedder({ maxPerWindow: 10, windowMs: 60_000 });
    expect(s.admit(8, 0).ok).toBe(true);
    const over = s.admit(5, 15_000);
    expect(over.ok).toBe(false);
    expect(over.retryAfterSec).toBe(45);
    expect(s.admit(2, 20_000).ok).toBe(true); // a maradék belefér
    expect(s.admit(10, 60_000).ok).toBe(true); // új ablak
  });
});
