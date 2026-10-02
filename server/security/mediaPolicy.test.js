const { detectKind, validateFile, validateUploads, profileFor, MEDIA_PROFILES } = require('./mediaPolicy');

// ── magic-byte fixture-építők ────────────────────────────────────────────────
function bytes(arr) {
  const b = Buffer.alloc(32);
  for (let i = 0; i < arr.length; i++) b[i] = arr[i];
  return b;
}
function ascii(s) {
  const b = Buffer.alloc(32);
  b.write(s, 0, 'latin1');
  return b;
}
function ftyp(brand) {
  const b = Buffer.alloc(32);
  b.write('ftyp', 4, 'latin1');
  b.write(brand, 8, 'latin1');
  return b;
}
function riff(form) {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'latin1');
  b.write(form, 8, 'latin1');
  return b;
}

const H = {
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0]),
  gif: ascii('GIF89a'),
  webp: riff('WEBP'),
  heic: ftyp('heic'),
  mp4: ftyp('isom'),
  mov: ftyp('qt  '),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3]),
  wav: riff('WAVE'),
  m4a: ftyp('M4A '),
  mp3id3: ascii('ID3\x03'),
  mp3frame: bytes([0xff, 0xfb, 0x90, 0x00]),
  ogg: ascii('OggS'),
  flac: ascii('fLaC'),
  exe: bytes([0x4d, 0x5a, 0x90, 0x00]), // MZ
};

describe('mediaPolicy — detectKind (magic-byte)', () => {
  it.each([
    ['png', 'image'],
    ['jpeg', 'image'],
    ['gif', 'image'],
    ['webp', 'image'],
    ['heic', 'image'],
    ['mp4', 'video'],
    ['mov', 'video'],
    ['webm', 'video'],
    ['wav', 'audio'],
    ['m4a', 'audio'],
    ['mp3id3', 'audio'],
    ['mp3frame', 'audio'],
    ['ogg', 'audio'],
    ['flac', 'audio'],
  ])('%s → %s', (key, expected) => {
    expect(detectKind(H[key])).toBe(expected);
  });

  it('nem-média (EXE) → null', () => {
    expect(detectKind(H.exe)).toBeNull();
  });
  it('túl rövid buffer → null', () => {
    expect(detectKind(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('mediaPolicy — validateFile', () => {
  const img = profileFor('image');

  it('valódi PNG .png néven → OK', () => {
    expect(validateFile({ originalname: 'logo.png', size: 1000 }, H.png, img)).toMatchObject({ ok: true, kind: 'image' });
  });

  it('⚠️ hamis tartalom: .png név, de EXE tartalom → 415', () => {
    expect(validateFile({ originalname: 'logo.png', size: 1000 }, H.exe, img)).toMatchObject({ ok: false, status: 415 });
  });

  it('⚠️ kind-eltérés: .png név, de VIDEÓ tartalom → 415', () => {
    expect(validateFile({ originalname: 'clip.png', size: 1000 }, H.mp4, img)).toMatchObject({ ok: false, status: 415 });
  });

  it('nem engedett kiterjesztés (.exe) → 415', () => {
    expect(validateFile({ originalname: 'x.exe', size: 10 }, H.png, img)).toMatchObject({ ok: false, status: 415 });
  });

  it('hiányzó kiterjesztés + valódi PNG tartalom → OK (tolerancia)', () => {
    expect(validateFile({ originalname: 'frame', size: 10 }, H.png, img)).toMatchObject({ ok: true });
  });

  it('túl nagy fájl → 413', () => {
    expect(validateFile({ originalname: 'big.png', size: 50 * 1024 * 1024 }, H.png, img)).toMatchObject({ ok: false, status: 413 });
  });

  it('path-traversal fájlnév → 400', () => {
    expect(validateFile({ originalname: '../../etc/passwd.png', size: 10 }, H.png, img)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('mediaPolicy — validateUploads (darabszám + batch)', () => {
  it('video profil: 2 fájl → 413 (maxCount 1)', () => {
    const files = [
      { originalname: 'a.mp4', size: 10, header: H.mp4 },
      { originalname: 'b.mp4', size: 10, header: H.mp4 },
    ];
    expect(validateUploads(files, 'video')).toMatchObject({ ok: false, status: 413 });
  });

  it('üres feltöltés → 400', () => {
    expect(validateUploads([], 'image')).toMatchObject({ ok: false, status: 400 });
  });

  it('image profil: [png, jpg] → OK', () => {
    const files = [
      { originalname: 'a.png', size: 10, header: H.png },
      { originalname: 'b.jpg', size: 10, header: H.jpeg },
    ];
    expect(validateUploads(files, 'image')).toMatchObject({ ok: true });
  });

  it('egy rossz fájl az egész batch-et elutasítja', () => {
    const files = [
      { originalname: 'a.png', size: 10, header: H.png },
      { originalname: 'evil.png', size: 10, header: H.exe },
    ];
    expect(validateUploads(files, 'image')).toMatchObject({ ok: false, status: 415 });
  });
});

describe('mediaPolicy — profilok', () => {
  it('minden profil kinds-e a {image,video,audio} részhalmaza', () => {
    for (const p of Object.values(MEDIA_PROFILES)) {
      for (const k of p.kinds) {
        expect(['image', 'video', 'audio']).toContain(k);
      }
      expect(p.maxBytes).toBeGreaterThan(0);
      expect(p.maxCount).toBeGreaterThan(0);
    }
  });
});
