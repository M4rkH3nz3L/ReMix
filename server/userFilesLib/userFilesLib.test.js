// 🗂️ A server/userFilesLib/ modulcsalád regressziós tesztjei (REFACTOR): a userFiles.js bontása után az
// út-segédek, a hibatípus, a mappa-fa / Lomtár / darabolt feltöltés gyárai és az S3-backend JELENLEGI
// viselkedését rögzítik (az S3-kliens és az SDK mockolva, a backend memóriában).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

jest.mock('../s3store', () => {
  const st = { enabled: false, sent: [], reply: async () => ({}) };
  return {
    __st: st,
    BUCKET: 'media',
    s3Enabled: () => st.enabled,
    client: () => ({ send: async (cmd) => (st.sent.push([cmd.name, cmd.input]), st.reply(cmd.name, cmd.input)) }),
  };
});
jest.mock('@aws-sdk/client-s3', () => {
  const out = {};
  for (const n of ['ListObjectsV2Command', 'HeadObjectCommand', 'PutObjectCommand', 'DeleteObjectCommand', 'CopyObjectCommand', 'GetObjectCommand', 'CreateMultipartUploadCommand', 'UploadPartCommand', 'ListPartsCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand']) {
    out[n] = class {
      constructor(input) {
        this.name = n;
        this.input = input;
      }
    };
  }
  return out;
});

const s3 = require('../s3store');
const facade = require('../userFiles');
const constants = require('./constants');
const { UserFilesError, badPath, notFound } = require('./errors');
const paths = require('./paths');
const { md5OfFile } = require('./md5');
const { localBackend } = require('./localBackend');
const { s3Backend, filesBucket } = require('./s3Backend');
const { resolveBackend } = require('./resolveBackend');
const { createUserFiles } = require('./createUserFiles');
const { createTreeOps } = require('./treeOps');
const { createTrashOps } = require('./trashOps');
const { createUploadSessionOps } = require('./uploadSessionOps');
const { createFileOps } = require('./fileOps');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

/** memória-backend a közös felülettel (a hívásokat naplózza) */
function memBackend() {
  const store = new Map();
  const calls = [];
  const be = {
    store,
    calls,
    async list(prefix) {
      const folders = new Set();
      const files = [];
      for (const [k, v] of [...store].sort()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i >= 0) folders.add(rest.slice(0, i));
        else if (rest !== '.folder') files.push({ name: rest, size: v.length, modified: 'm' });
      }
      return { folders: [...folders], files };
    },
    async listAll(prefix) {
      return [...store].sort().filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length }));
    },
    async head(key) {
      const v = store.get(key);
      return v ? { size: v.length, modified: 'm', etag: md5(v) } : null;
    },
    async put(key, localPath) {
      store.set(key, fs.readFileSync(localPath));
    },
    async putEmpty(key) {
      store.set(key, Buffer.alloc(0));
    },
    async remove(key) {
      calls.push(['remove', key]);
      store.delete(key);
    },
    async copy(from, to) {
      store.set(to, store.get(from));
    },
    async stream(key) {
      const v = store.get(key);
      return v ? { body: Readable.from([v]), size: v.length, contentType: null } : null;
    },
    async putText(key, text) {
      store.set(key, Buffer.from(text));
    },
    async readText(key) {
      const v = store.get(key);
      return v ? v.toString('utf8') : null;
    },
  };
  return be;
}
const ledgerOf = (limit = Infinity) => {
  const L = { log: [], used: 0 };
  L.wouldExceed = async (uid, bytes) => ({ exceeded: L.used + bytes > limit, usage: { used: L.used } });
  L.recordObject = async (uid, e) => (L.log.push(['record', uid, e.key, e.bytes]), (L.used += e.bytes));
  L.forgetObject = async (uid, b, key) => L.log.push(['forget', uid, b, key]);
  L.moveObject = async (uid, b, from, to) => L.log.push(['move', uid, b, from, to]);
  return L;
};

let tmp;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uflib-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const src = (name, body) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body);
  return p;
};

describe('a facade a modulcsalád ugyanazon értékeit adja tovább', () => {
  test('az export-kulcsok sorrendje és az azonosságok', () => {
    expect(Object.keys(facade)).toEqual(['MARKER', 'TRASH_RETENTION_DAYS', 'PART_SIZE', 'UserFilesError', 'normalizePath', 'cleanSegment', 'joinPath', 'parentOf', 'userRoot', 'nextFreeName', 'md5OfFile', 'localBackend', 'resolveBackend', 'filesBucket', 'createUserFiles']);
    expect(facade.UserFilesError).toBe(UserFilesError);
    expect(facade.normalizePath).toBe(paths.normalizePath);
    expect(facade.md5OfFile).toBe(md5OfFile);
    expect(facade.localBackend).toBe(localBackend);
    expect(facade.resolveBackend).toBe(resolveBackend);
    expect(facade.filesBucket).toBe(filesBucket);
    expect(facade.createUserFiles).toBe(createUserFiles);
  });
  test('az állandók', () => {
    expect(constants).toEqual({ MARKER: '.folder', MAX_SEGMENT: 120, MAX_DEPTH: 20, MAX_PATH: 512, MAX_TREE: 1000, TRASH_RETENTION_DAYS: 30, TRASH_META: '.meta.json', PART_SIZE: 8388608, UPLOAD_SESSION_DAYS: 7 });
  });
});

describe('errors', () => {
  test('a UserFilesError mezői; az üzenet hiányában a kód', () => {
    const e = new UserFilesError(418, 'teapot');
    expect([e.name, e.status, e.code, e.message, e instanceof Error]).toEqual(['UserFilesError', 418, 'teapot', 'teapot', true]);
  });
  test('badPath / notFound', () => {
    expect([badPath().status, badPath().code, badPath().message, badPath('x').message]).toEqual([400, 'bad_path', 'Érvénytelen útvonal.', 'x']);
    expect([notFound().status, notFound().code, notFound().message]).toEqual([404, 'not_found', 'Nincs ilyen fájl vagy mappa.']);
  });
});

describe('paths', () => {
  test('a kódolt / unicode / szóközös szegmenseket NEM dekódolja, csak vágja', () => {
    expect(paths.normalizePath(' a / %2e%2e /ő.mp4')).toBe('a/%2e%2e/ő.mp4');
    expect(paths.normalizePath('...')).toBe('...');
  });
  test('hossz- és mélységkorlát pontosan a határon', () => {
    expect(paths.cleanSegment('a'.repeat(120))).toHaveLength(120);
    expect(() => paths.cleanSegment('a'.repeat(121))).toThrow('Érvénytelen név.');
    expect(paths.normalizePath(Array(20).fill('a').join('/'))).toHaveLength(39);
    expect(() => paths.normalizePath(Array(21).fill('a').join('/'))).toThrow('Túl mély mappaszerkezet.');
    expect(() => paths.normalizePath(Array(5).fill('b'.repeat(110)).join('/'))).toThrow('Túl hosszú útvonal.');
  });
  test('a userId-ből a nem-szó karakterek kiesnek (nem utasítja el)', () => {
    expect(paths.userRoot('../alice')).toBe('files/alice/');
    expect(paths.userTrash('a/b')).toBe('trash/ab/');
    expect(paths.userUploads('x-1')).toBe('uploads/x-1/');
    expect(() => paths.userTrash('/')).toThrow(expect.objectContaining({ status: 401 }));
  });
  test('baseName / parentOf / joinPath', () => {
    expect([paths.baseName('a/b/c'), paths.baseName('c'), paths.parentOf('a/b/c'), paths.parentOf('c'), paths.joinPath('', 'x'), paths.joinPath('a', 'x')]).toEqual(['c', 'c', 'a/b', '', 'x', 'a/x']);
  });
  test('nextFreeName: a pont-kezdetű név kiterjesztés nélkülinek számít', () => {
    expect(paths.nextFreeName('.env', new Set(['.env']))).toBe('.env (1)');
    expect(paths.nextFreeName('a.b.c', new Set(['a.b.c']))).toBe('a.b (1).c');
  });
});

describe('treeOps', () => {
  test('isFolder: a gyökér mindig mappa; üres mappa csak a jelölővel', async () => {
    const be = memBackend();
    const t = createTreeOps({ backend: be, ledger: ledgerOf(), bucket: 'b' });
    expect(await t.isFolder('u', '')).toBe(true);
    expect(await t.isFolder('u', 'x')).toBe(false);
    be.store.set('files/u/x/.folder', Buffer.alloc(0));
    expect(await t.isFolder('u', 'x')).toBe(true);
  });
  test('relocate: előbb MINDEN másolat + ellenőrzés, csak utána főkönyv + törlés', async () => {
    const be = memBackend();
    const L = ledgerOf();
    be.store.set('files/u/d/a', Buffer.from('aa'));
    be.store.set('files/u/d/b', Buffer.from('b'));
    const t = createTreeOps({ backend: be, ledger: L, bucket: 'b' });
    const { pairs, isFolder } = await t.pairsFor('files/u/d', 'files/u/e');
    expect(isFolder).toBe(true);
    expect(pairs).toEqual([{ from: 'files/u/d/a', to: 'files/u/e/a', size: 2 }, { from: 'files/u/d/b', to: 'files/u/e/b', size: 1 }]);
    await t.relocate('u', pairs);
    expect(L.log).toEqual([['move', 'u', 'b', 'files/u/d/a', 'files/u/e/a'], ['move', 'u', 'b', 'files/u/d/b', 'files/u/e/b']]);
    expect([...be.store.keys()].sort()).toEqual(['files/u/e/a', 'files/u/e/b']);
  });
  test('pairsFor: hiányzó → 404, 1000 felett → 413', async () => {
    const be = memBackend();
    const t = createTreeOps({ backend: be, ledger: ledgerOf(), bucket: 'b' });
    await expect(t.pairsFor('files/u/none', 'x')).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 1001; i++) be.store.set(`files/u/big/${i}`, Buffer.from('x'));
    await expect(t.pairsFor('files/u/big', 'x')).rejects.toMatchObject({ status: 413, code: 'too_many', message: 'Túl sok elem egyszerre — végezd részenként.' });
  });
});

describe('fileOps', () => {
  test('a másik user prefixe alá nem lehet nyúlni (open / remove)', async () => {
    const be = memBackend();
    be.store.set('files/alice/a.bin', Buffer.from('secret'));
    const ops = createFileOps({ backend: be, ledger: ledgerOf(), bucket: 'b' }, createTreeOps({ backend: be, ledger: ledgerOf(), bucket: 'b' }));
    await expect(ops.open('bob', 'a.bin')).rejects.toMatchObject({ status: 404 });
    await expect(ops.open('bob', '../alice/a.bin')).rejects.toMatchObject({ status: 400 });
    await expect(ops.remove('bob', 'a.bin')).rejects.toMatchObject({ status: 404 });
    expect(be.store.has('files/alice/a.bin')).toBe(true);
  });
  test('upload: kvóta-túllépés → 507 + usage, nem tárol', async () => {
    const be = memBackend();
    const ops = createFileOps({ backend: be, ledger: ledgerOf(5), bucket: 'b' }, createTreeOps({ backend: be, ledger: ledgerOf(), bucket: 'b' }));
    await expect(ops.upload('u', '', { localPath: src('q.bin', '123456'), name: 'q.bin' })).rejects.toMatchObject({ status: 507, code: 'quota_exceeded', usage: { used: 0 } });
    expect(be.store.size).toBe(0);
  });
});

describe('trashOps', () => {
  test('lomtárba → lista → visszaállítás ütközéssel', async () => {
    const be = memBackend();
    const L = ledgerOf();
    const tree = createTreeOps({ backend: be, ledger: L, bucket: 'b' });
    const t = createTrashOps({ backend: be, ledger: L, bucket: 'b' }, tree);
    be.store.set('files/u/a.txt', Buffer.from('abc'));
    const r = await t.trash('u', 'a.txt');
    expect(r).toMatchObject({ removed: 1, bytes: 3 });
    expect(r.id).toMatch(/^[a-z0-9]+-[a-f0-9]{6}$/);
    const now = Date.now();
    const l = await t.listTrash('u', now);
    expect(l).toMatchObject({ retentionDays: 30, bytes: 3, items: [{ id: r.id, path: 'a.txt', name: 'a.txt', isFolder: false, count: 1 }] });
    be.store.set('files/u/a.txt', Buffer.from('new'));
    expect(await t.restoreTrash('u', r.id)).toEqual({ path: 'a (1).txt', name: 'a (1).txt' });
    expect(await t.listTrash('u', now)).toMatchObject({ items: [] });
  });
  test('a lejárt (30 nap) és a sérült bejegyzés a listázáskor végleg törlődik', async () => {
    const be = memBackend();
    const L = ledgerOf();
    const t = createTrashOps({ backend: be, ledger: L, bucket: 'b' }, createTreeOps({ backend: be, ledger: L, bucket: 'b' }));
    const now = Date.UTC(2026, 0, 31);
    be.store.set('trash/u/old-aaaaaa/.meta.json', Buffer.from(JSON.stringify({ path: 'x', deletedAt: new Date(now - 30 * 86400000).toISOString() })));
    be.store.set('trash/u/old-aaaaaa/x', Buffer.from('12'));
    be.store.set('trash/u/bad-bbbbbb/.meta.json', Buffer.from('{'));
    expect(await t.listTrash('u', now)).toEqual({ items: [], retentionDays: 30, bytes: 0 });
    expect(be.store.size).toBe(0);
    expect(L.log.map((x) => x[3]).sort()).toEqual(['trash/u/bad-bbbbbb/.meta.json', 'trash/u/old-aaaaaa/.meta.json', 'trash/u/old-aaaaaa/x']);
  });
  test('az azonosító-szűrő: kiszökés / nagybetű → 400', async () => {
    const be = memBackend();
    const t = createTrashOps({ backend: be, ledger: ledgerOf(), bucket: 'b' }, createTreeOps({ backend: be, ledger: ledgerOf(), bucket: 'b' }));
    for (const bad of ['../x-abcdef', 'k-ABCDEF', 'k-abcde', null]) {
      await expect(t.restoreTrash('u', bad)).rejects.toMatchObject({ status: 400, message: 'Érvénytelen Lomtár-azonosító.' });
      await expect(t.purgeTrash('u', [bad])).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe('uploadSessionOps', () => {
  /** memória-multipart a backendre */
  const withMp = (be) => {
    const mp = new Map();
    let n = 0;
    Object.assign(be, {
      mpInit: async () => (mp.set(`m${n}`, new Map()), `m${n++}`),
      mpPart: async (k, id, i, p) => mp.get(id).set(i, fs.readFileSync(p)),
      mpListParts: async (k, id) => (mp.has(id) ? [...mp.get(id)].map(([partNumber, b]) => ({ partNumber, size: b.length })) : null),
      mpComplete: async (k, id, parts) => be.store.set(k, Buffer.concat(parts.map((p) => mp.get(id).get(p.partNumber)))),
      mpAbort: async (k, id) => mp.delete(id),
    });
    return be;
  };
  test('init → part × 3 → status → complete; a darabméret és a sorszám ellenőrzött', async () => {
    const be = withMp(memBackend());
    const L = ledgerOf();
    const u = createUploadSessionOps({ backend: be, ledger: L, bucket: 'b', partSize: 4 });
    const body = '0123456789';
    const r = await u.uploadInit('u', '', { name: 'f.bin', size: 10, md5: md5(body) }, Date.UTC(2026, 0, 1));
    expect(r).toMatchObject({ partSize: 4, parts: 3 });
    expect(r.uploadId).toMatch(/^[a-f0-9]{32}$/);
    await expect(u.uploadPart('u', r.uploadId, 4, src('p1', '0123'))).rejects.toMatchObject({ message: 'Érvénytelen darab-sorszám.' });
    await expect(u.uploadPart('u', r.uploadId, 3, src('px', '890'))).rejects.toMatchObject({ code: 'bad_part', message: 'A darab mérete hibás (3 ≠ 2).' });
    await u.uploadPart('u', r.uploadId, 1, src('p1', '0123'));
    await u.uploadPart('u', r.uploadId, 3, src('p3', '89'));
    await expect(u.uploadComplete('u', r.uploadId)).rejects.toMatchObject({ status: 409, code: 'parts_missing', missing: [2] });
    await u.uploadPart('u', r.uploadId, 2, src('p2', '4567'));
    expect(await u.uploadStatus('u', r.uploadId)).toEqual({ uploadId: r.uploadId, size: 10, partSize: 4, parts: 3, done: [1, 3, 2] });
    expect(await u.uploadComplete('u', r.uploadId)).toEqual({ name: 'f.bin', path: 'f.bin', size: 10, md5: md5(body), deduplicated: false });
    expect(be.store.get('files/u/f.bin').toString()).toBe(body);
    expect(L.log).toEqual([['record', 'u', 'files/u/f.bin', 10]]);
    expect([...be.store.keys()].filter((k) => k.startsWith('uploads/'))).toEqual([]);
  });
  test('a munkamenet a user prefixe alatt él: a másik user 404-et kap', async () => {
    const be = withMp(memBackend());
    const u = createUploadSessionOps({ backend: be, ledger: ledgerOf(), bucket: 'b', partSize: 4 });
    const r = await u.uploadInit('alice', '', { name: 'f.bin', size: 2, md5: md5('ab') });
    await expect(u.uploadStatus('bob', r.uploadId)).rejects.toMatchObject({ status: 404, code: 'upload_not_found' });
    await expect(u.uploadStatus('alice', `../bob/${r.uploadId}`)).rejects.toMatchObject({ status: 400 });
  });
  test('sérült munkamenet-JSON: a takarítás kivételt dob (jelenlegi viselkedés)', async () => {
    const be = withMp(memBackend());
    be.store.set('uploads/u/x.json', Buffer.from('{'));
    const u = createUploadSessionOps({ backend: be, ledger: ledgerOf(), bucket: 'b', partSize: 4 });
    await expect(u.uploadInit('u', '', { name: 'f.bin', size: 2, md5: md5('ab') })).rejects.toThrow(SyntaxError);
  });
});

describe('s3Backend / resolveBackend', () => {
  const st = s3.__st;
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    st.enabled = false;
    st.sent.length = 0;
    st.reply = async () => ({});
  });
  test('filesBucket: S3_FILES_BUCKET (trimmelve), különben a közös bucket', () => {
    delete process.env.S3_FILES_BUCKET;
    expect(filesBucket()).toBe('media');
    process.env.S3_FILES_BUCKET = ' priv ';
    expect(filesBucket()).toBe('priv');
  });
  test('resolveBackend sorrend: r2|s3 (+S3) → s3 · lokális dir → local · S3 → s3 · különben null', () => {
    delete process.env.STORAGE_BACKEND;
    delete process.env.USER_FILES_LOCAL_DIR;
    delete process.env.MEDIA_LOCAL_DIR;
    expect(resolveBackend()).toBeNull();
    st.enabled = true;
    expect(resolveBackend().kind).toBe('s3');
    process.env.MEDIA_LOCAL_DIR = tmp;
    expect(resolveBackend().kind).toBe('local');
    process.env.STORAGE_BACKEND = ' R2 ';
    expect(resolveBackend().kind).toBe('s3');
    st.enabled = false;
    expect(resolveBackend().kind).toBe('local');
  });
  test('head: a hiány (NotFound / NoSuchKey / 404) → null, más hiba továbbmegy', async () => {
    process.env.S3_FILES_BUCKET = 'priv';
    const be = s3Backend();
    st.reply = async () => {
      throw Object.assign(new Error('x'), { name: 'Whatever', $metadata: { httpStatusCode: 404 } });
    };
    expect(await be.head('k')).toBeNull();
    st.reply = async () => {
      throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    };
    await expect(be.head('k')).rejects.toThrow('denied');
    expect(st.sent).toEqual([['HeadObjectCommand', { Bucket: 'priv', Key: 'k' }], ['HeadObjectCommand', { Bucket: 'priv', Key: 'k' }]]);
  });
  test('copy: a CopySource szegmensenként URL-kódolt; mpAbort hibája csak naplózódik', async () => {
    process.env.S3_FILES_BUCKET = 'priv';
    const be = s3Backend();
    await be.copy('files/u/a b/ő#.bin', 'files/u/c');
    expect(st.sent[0]).toEqual(['CopyObjectCommand', { Bucket: 'priv', Key: 'files/u/c', CopySource: 'priv/files/u/a%20b/%C5%91%23.bin' }]);
    st.reply = async () => {
      throw new Error('gone');
    };
    await expect(be.mpAbort('k', 'id')).resolves.toBeUndefined();
  });
  test('mpPart: a ContentMD5 a darab MD5-je base64-ben, az ETag idézőjelek nélkül', async () => {
    const be = s3Backend();
    st.reply = async () => ({ ETag: '"abc"' });
    expect(await be.mpPart('k', 'id', 2, src('mp.bin', 'hello'))).toBe('abc');
    const [name, input] = st.sent[0];
    expect(name).toBe('UploadPartCommand');
    expect(input).toMatchObject({ Key: 'k', UploadId: 'id', PartNumber: 2, ContentMD5: Buffer.from(md5('hello'), 'hex').toString('base64') });
  });
});

test('createUserFiles: backend nélkül 503; a kulcsok sorrendje', () => {
  expect(() => createUserFiles({ backend: null })).toThrow(expect.objectContaining({ status: 503, code: 'storage_unconfigured' }));
  expect(Object.keys(createUserFiles({ backend: memBackend(), ledger: ledgerOf() }))).toEqual(['list', 'mkdir', 'upload', 'remove', 'move', 'open', 'trash', 'listTrash', 'restoreTrash', 'purgeTrash', 'uploadInit', 'uploadStatus', 'uploadPart', 'uploadComplete', 'uploadAbort']);
});

test('localBackend: a gyökéren kívüli kulcs → 400', async () => {
  const lb = localBackend(tmp);
  await expect(lb.head('../x')).rejects.toMatchObject({ status: 400 });
  await expect(lb.readText('/etc/passwd')).rejects.toMatchObject({ status: 400 });
});
