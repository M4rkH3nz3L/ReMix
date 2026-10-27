// 🗂️ ReMix Storage mag — út-normalizálás + műveletek a lokális disk-backenden.
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MARKER,
  UserFilesError,
  createUserFiles,
  localBackend,
  md5OfFile,
  nextFreeName,
  normalizePath,
  userRoot,
} = require('./userFiles');

describe('normalizePath', () => {
  test('perjelek és üres szegmensek kisimítva, gyökér = üres', () => {
    expect(normalizePath('/a//b/')).toBe('a/b');
    expect(normalizePath('')).toBe('');
    expect(normalizePath(undefined)).toBe('');
  });
  test('kiszökés / vezérlőkarakter / jelölőnév → 400', () => {
    for (const bad of ['../x', 'a/../../b', 'a/./b', 'a\\b', 'x\u0000', MARKER]) {
      expect(() => normalizePath(bad)).toThrow(UserFilesError);
    }
  });
  test('túl mély út → hiba', () => {
    expect(() => normalizePath(Array(25).fill('a').join('/'))).toThrow(/mély/);
  });
});

test('userRoot: a userId-t szűrjük, üres → 401', () => {
  expect(userRoot('ab-12')).toBe('files/ab-12/');
  expect(userRoot('a/../b')).toBe('files/ab/');
  expect(() => userRoot('')).toThrow(UserFilesError);
});

test('nextFreeName: (1), (2) … a kiterjesztés előtt', () => {
  expect(nextFreeName('a.mp4', new Set())).toBe('a.mp4');
  expect(nextFreeName('a.mp4', new Set(['a.mp4']))).toBe('a (1).mp4');
  expect(nextFreeName('a.mp4', new Set(['a.mp4', 'a (1).mp4']))).toBe('a (2).mp4');
  expect(nextFreeName('noext', new Set(['noext']))).toBe('noext (1)');
});

describe('createUserFiles (lokális backend)', () => {
  let root;
  let tmp;
  let ledger;
  let svc;

  const src = (name, body) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-root-'));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-src-'));
    ledger = {
      rows: new Map(),
      quota: Infinity,
      async wouldExceed(_uid, bytes) {
        const used = [...this.rows.values()].reduce((a, b) => a + b, 0);
        return { exceeded: used + bytes > this.quota, usage: { used_bytes: used } };
      },
      async recordObject(_uid, { key, bytes }) {
        this.rows.set(key, bytes);
      },
      async forgetObject(_uid, _bucket, key) {
        this.rows.delete(key);
      },
      async moveObject(_uid, _bucket, from, to) {
        this.rows.set(to, this.rows.get(from));
        this.rows.delete(from);
      },
    };
    svc = createUserFiles({ backend: localBackend(root), ledger });
  });

  test('backend nélkül → 503', () => {
    expect(() => createUserFiles({ backend: null, ledger })).toThrow(/nincs konfigurálva/);
  });

  test('üres gyökér listázható', async () => {
    expect(await svc.list('u1', '')).toEqual({ path: '', folders: [], files: [] });
  });

  test('mappa létrehozás → listázva (üresen is), ütközés → 409', async () => {
    await svc.mkdir('u1', '', 'Videók');
    const l = await svc.list('u1', '');
    expect(l.folders).toEqual([{ name: 'Videók', path: 'Videók' }]);
    expect((await svc.list('u1', 'Videók')).files).toEqual([]);
    await expect(svc.mkdir('u1', '', 'Videók')).rejects.toMatchObject({ status: 409 });
  });

  test('nem létező mappa listázása → 404', async () => {
    await expect(svc.list('u1', 'nincs')).rejects.toMatchObject({ status: 404 });
  });

  test('feltöltés → főkönyv + listázás; másik user nem látja', async () => {
    await svc.mkdir('u1', '', 'Klipek');
    const out = await svc.upload('u1', 'Klipek', { localPath: src('a.mp4', 'hello'), name: 'a.mp4' });
    expect(out).toMatchObject({ name: 'a.mp4', path: 'Klipek/a.mp4', size: 5, deduplicated: false });
    expect(ledger.rows.get('files/u1/Klipek/a.mp4')).toBe(5);
    expect((await svc.list('u1', 'Klipek')).files.map((f) => f.name)).toEqual(['a.mp4']);
    expect((await svc.list('u2', '')).folders).toEqual([]);
  });

  test('integritás: hibás md5 → 422 és nem tárolódik', async () => {
    const p = src('b.wav', 'abc');
    await expect(svc.upload('u1', '', { localPath: p, name: 'b.wav', md5: 'deadbeef' })).rejects.toMatchObject({
      status: 422,
    });
    expect((await svc.list('u1', '')).files).toEqual([]);
    const ok = await svc.upload('u1', '', { localPath: p, name: 'b.wav', md5: await md5OfFile(p) });
    expect(ok.size).toBe(3);
  });

  test('idempotens újrapróbálás: azonos tartalom → nincs duplikátum; eltérő → (1)', async () => {
    await svc.upload('u1', '', { localPath: src('c.jpg', 'xyz'), name: 'c.jpg' });
    const again = await svc.upload('u1', '', { localPath: src('c2.jpg', 'xyz'), name: 'c.jpg' });
    expect(again.deduplicated).toBe(true);
    const other = await svc.upload('u1', '', { localPath: src('c3.jpg', 'xyw'), name: 'c.jpg' });
    expect(other.name).toBe('c (1).jpg');
    expect((await svc.list('u1', '')).files).toHaveLength(2);
  });

  test('kvóta-túllépés → 507, semmi nem tárolódik', async () => {
    ledger.quota = 2;
    await expect(svc.upload('u1', '', { localPath: src('d.mp3', 'abc'), name: 'd.mp3' })).rejects.toMatchObject({
      status: 507,
    });
    expect((await svc.list('u1', '')).files).toEqual([]);
  });

  test('ha a főkönyv elutasít (verseny), az objektum is visszavonódik', async () => {
    ledger.recordObject = async () => {
      throw new Error('quota_exceeded');
    };
    await expect(svc.upload('u1', '', { localPath: src('e.mp3', 'abc'), name: 'e.mp3' })).rejects.toThrow();
    expect((await svc.list('u1', '')).files).toEqual([]);
  });

  test('átnevezés + mappa áthelyezése a főkönyvvel együtt', async () => {
    await svc.mkdir('u1', '', 'A');
    await svc.mkdir('u1', '', 'B');
    await svc.upload('u1', 'A', { localPath: src('f.png', '1234'), name: 'f.png' });
    await svc.move('u1', 'A/f.png', 'A/g.png');
    expect((await svc.list('u1', 'A')).files.map((f) => f.name)).toEqual(['g.png']);
    await svc.move('u1', 'A', 'B/A');
    expect((await svc.list('u1', '')).folders.map((f) => f.name)).toEqual(['B']);
    expect((await svc.list('u1', 'B/A')).files.map((f) => f.name)).toEqual(['g.png']);
    expect(ledger.rows.get('files/u1/B/A/g.png')).toBe(4);
    expect(ledger.rows.has('files/u1/A/g.png')).toBe(false);
  });

  test('áthelyezés: foglalt cél → 409, önmagába → 400', async () => {
    await svc.mkdir('u1', '', 'A');
    await svc.mkdir('u1', '', 'B');
    await expect(svc.move('u1', 'A', 'B')).rejects.toMatchObject({ status: 409 });
    await expect(svc.move('u1', 'A', 'A/x')).rejects.toMatchObject({ status: 400 });
  });

  test('törlés: fájl és mappa rekurzívan; gyökér nem törölhető', async () => {
    await svc.mkdir('u1', '', 'X');
    await svc.upload('u1', 'X', { localPath: src('h.mp4', '12'), name: 'h.mp4' });
    await svc.upload('u1', '', { localPath: src('i.mp4', '123'), name: 'i.mp4' });
    expect(await svc.remove('u1', 'i.mp4')).toEqual({ removed: 1, bytes: 3 });
    expect(await svc.remove('u1', 'X')).toEqual({ removed: 1, bytes: 2 });
    expect(ledger.rows.size).toBe(0);
    expect(await svc.list('u1', '')).toEqual({ path: '', folders: [], files: [] });
    await expect(svc.remove('u1', '')).rejects.toMatchObject({ status: 400 });
    await expect(svc.remove('u1', 'nincs')).rejects.toMatchObject({ status: 404 });
  });

  test('open: a tartalom visszaolvasható', async () => {
    await svc.upload('u1', '', { localPath: src('j.txt', 'tartalom'), name: 'j.txt' });
    const f = await svc.open('u1', 'j.txt');
    const chunks = [];
    for await (const c of f.body) {
      chunks.push(c);
    }
    expect(Buffer.concat(chunks).toString()).toBe('tartalom');
    await expect(svc.open('u1', 'nincs.txt')).rejects.toMatchObject({ status: 404 });
  });
});
