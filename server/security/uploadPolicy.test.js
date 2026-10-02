const fs = require('fs');
const os = require('os');
const path = require('path');
const { mediaGuard, readHeader } = require('./uploadPolicy');

// valódi temp-fájlok a lemezen (a guard onnan olvassa a magic-byte-ot)
let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploadpolicy-'));
});
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function writeFile(name, bytesArr) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(bytesArr));
  return { originalname: name, size: fs.statSync(p).size, path: p };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const EXE = [0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];

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

describe('uploadPolicy — readHeader', () => {
  it('a fájl első bájtjait adja', () => {
    const f = writeFile('a.png', PNG);
    const h = readHeader(f.path);
    expect(h[0]).toBe(0x89);
    expect(h[1]).toBe(0x50);
  });
  it('nemlétező fájl → üres buffer', () => {
    expect(readHeader(path.join(dir, 'nincs.png')).length).toBe(0);
  });
});

describe('uploadPolicy — mediaGuard middleware', () => {
  it('valódi PNG image-profilon → next()', () => {
    const f = writeFile('ok.png', PNG);
    const req = { files: [f] };
    const res = mockRes();
    const next = jest.fn();
    mediaGuard('image')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('⚠️ EXE .png néven → 415 + a fájl törölve, next NEM hívódik', () => {
    const f = writeFile('evil.png', EXE);
    const req = { files: [f] };
    const res = mockRes();
    const next = jest.fn();
    mediaGuard('image')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(415);
    expect(fs.existsSync(f.path)).toBe(false); // cleanup megtörtént
  });

  it('nincs fájl → 400', () => {
    const res = mockRes();
    const next = jest.fn();
    mediaGuard('image')({ files: [] }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
