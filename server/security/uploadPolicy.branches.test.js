// 🧰 uploadPolicy — a cleanup / workDir / blockActiveContent ágai és a fájlrendszer-hibák.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mediaGuard, blockActiveContent, readHeader } = require('./uploadPolicy');

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploadpolicy-br-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(() => jest.restoreAllMocks());

function writeFile(name, bytes) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return { originalname: name, size: fs.statSync(p).size, path: p };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const EXE = [0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];
const HTML = Array.from(Buffer.from('<!doctype html><script>alert(1)</script>'));

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

describe('uploadPolicy — readHeader határesetek', () => {
  it('32 bájtnál rövidebb fájl → pontosan a meglévő bájtok', () => {
    const f = writeFile('short.bin', [1, 2, 3]);
    expect([...readHeader(f.path)]).toEqual([1, 2, 3]);
  });

  it('hosszú fájlból csak az első 32 bájt', () => {
    const f = writeFile('long.bin', Array.from({ length: 100 }, (_, i) => i));
    const h = readHeader(f.path);
    expect(h.length).toBe(32);
    expect(h[31]).toBe(31);
  });

  it('a lezárás hibája nem dob, a beolvasott fejléc megmarad', () => {
    const f = writeFile('close.png', PNG);
    const realClose = fs.closeSync;
    const spy = jest.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      realClose(fd); // a leírót ténylegesen lezárjuk, csak a hibát szimuláljuk
      throw new Error('EBADF');
    });
    const h = readHeader(f.path);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(h[0]).toBe(0x89);
  });
});

describe('uploadPolicy — mediaGuard ágak', () => {
  it('req.files nélkül → 400, next nem hívódik', () => {
    const res = mockRes();
    const next = jest.fn();
    mediaGuard('image')({}, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('elutasításkor a kérés munkakönyvtára is törlődik (I45)', async () => {
    const workDir = fs.mkdtempSync(path.join(dir, 'work-'));
    const f = writeFile('evil2.png', EXE);
    const res = mockRes();
    const rm = jest.spyOn(fs, 'rm');
    mediaGuard('image')({ files: [f], workDir }, res, jest.fn());
    expect(res.statusCode).toBe(415);
    expect(rm).toHaveBeenCalledWith(workDir, { recursive: true, force: true }, expect.any(Function));
    // az fs.rm aszinkron: a callbackjét bevárjuk
    await new Promise((resolve) => {
      const tick = () => (fs.existsSync(workDir) ? setTimeout(tick, 5) : resolve());
      tick();
    });
    expect(fs.existsSync(workDir)).toBe(false);
  });

  it('a már eltűnt fájl törlési hibája nem dob, a válasz így is 415', () => {
    const f = writeFile('gone.png', EXE);
    const unlink = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const res = mockRes();
    expect(() => mediaGuard('image')({ files: [f] }, res, jest.fn())).not.toThrow();
    expect(unlink).toHaveBeenCalledWith(f.path);
    expect(res.statusCode).toBe(415);
  });
});

describe('uploadPolicy — blockActiveContent', () => {
  it('ártalmatlan fájlok → next(), semmi nem törlődik', () => {
    const f = writeFile('ok.png', PNG);
    const res = mockRes();
    const next = jest.fn();
    blockActiveContent({ files: [f] }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(f.path)).toBe(true);
  });

  it('req.files nélkül → next()', () => {
    const next = jest.fn();
    blockActiveContent({}, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('HTML-tartalom ártalmatlan néven → 415 + MINDEN feltöltött fájl törölve', () => {
    const good = writeFile('kep.png', PNG);
    const bad = writeFile('kep2.png', HTML);
    const res = mockRes();
    const next = jest.fn();
    blockActiveContent({ files: [good, bad] }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(415);
    expect(res.body).toEqual({ error: 'Ez a fájltípus nem tölthető fel.' });
    expect(fs.existsSync(good.path)).toBe(false);
    expect(fs.existsSync(bad.path)).toBe(false);
  });

  it('aktív kiterjesztés (.svg) → 415; a path nélküli / üres bejegyzést a cleanup kihagyja', () => {
    const svg = writeFile('rajz.svg', PNG);
    const res = mockRes();
    const unlink = jest.spyOn(fs, 'unlinkSync');
    // a find az első (svg) találatnál megáll, így a null / path nélküli elemig csak a cleanup jut el
    blockActiveContent({ files: [svg, { originalname: 'x' }, null] }, res, jest.fn());
    expect(res.statusCode).toBe(415);
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith(svg.path);
  });
});
