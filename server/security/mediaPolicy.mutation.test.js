// 🧪 mediaPolicy — mutációs rések zárása: minden magic-byte szabály pontos
// határai (egy bájttal eltérő „majdnem-fejléc” → null), minden profil minden
// engedett kiterjesztése, a méret-határok és a pontos hibaüzenetek.
const {
  detectKind,
  validateFile,
  validateUploads,
  profileFor,
  extOf,
  isActiveContent,
  safeExt,
  safeContentType,
  MEDIA_PROFILES,
} = require('./mediaPolicy');

const MB = 1024 * 1024;

/** 32 bájtos buffer a megadott kezdő-bájtokkal (a többi 0) */
function bytes(arr, len = 32) {
  const b = Buffer.alloc(len);
  arr.forEach((v, i) => {
    b[i] = v;
  });
  return b;
}
/** 32 bájtos buffer: `s` a 0. bájttól, opcionálisan `at8` a 8. bájttól (latin1) */
function text(s, at8) {
  const b = Buffer.alloc(32);
  b.write(s, 0, 'latin1');
  if (at8 !== undefined) b.write(at8, 8, 'latin1');
  return b;
}
function ftyp(brand) {
  const b = Buffer.alloc(32);
  b.write('ftyp', 4, 'latin1');
  b.write(brand, 8, 'latin1');
  return b;
}

const H = {
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0]),
  png: bytes([0x89, 0x50, 0x4e, 0x47]),
  gif: text('GIF89a'),
  webp: text('RIFF', 'WEBP'),
  bmp: bytes([0x42, 0x4d]),
  psd: text('8BPS'),
  heic: ftyp('heic'),
  ttf: bytes([0x00, 0x01, 0x00, 0x00]),
  otf: text('OTTO'),
  mp4: ftyp('isom'),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3]),
  mp3: text('ID3'),
  m4a: ftyp('M4A '),
  aac: bytes([0xff, 0xf1]),
  wav: text('RIFF', 'WAVE'),
  ogg: text('OggS'),
  flac: text('fLaC'),
  pdf: text('%PDF-1.7'),
};

describe('mediaPolicy — detectKind: hossz-határ és üres bemenet', () => {
  it.each([[null], [undefined]])('%p → null (nem dob)', (buf) => {
    expect(detectKind(buf)).toBeNull();
  });

  it('11 bájtos (érvényes PNG-kezdetű) buffer → null; 12 bájtos → image', () => {
    expect(detectKind(bytes([0x89, 0x50, 0x4e, 0x47], 11))).toBeNull();
    expect(detectKind(bytes([0x89, 0x50, 0x4e, 0x47], 12))).toBe('image');
  });

  it('üres buffer → null', () => {
    expect(detectKind(Buffer.alloc(0))).toBeNull();
  });
});

describe('mediaPolicy — detectKind: minden ismert fejléc a pontos kindra', () => {
  it.each([
    ['jpeg', 'image'],
    ['png', 'image'],
    ['gif', 'image'],
    ['webp', 'image'],
    ['bmp', 'image'],
    ['psd', 'image'],
    ['heic', 'image'],
    ['ttf', 'font'],
    ['otf', 'font'],
    ['mp4', 'video'],
    ['webm', 'video'],
    ['mp3', 'audio'],
    ['m4a', 'audio'],
    ['aac', 'audio'],
    ['wav', 'audio'],
    ['ogg', 'audio'],
    ['flac', 'audio'],
    ['pdf', 'document'],
  ])('%s → %s', (key, kind) => {
    expect(detectKind(H[key])).toBe(kind);
  });

  it("'true' (Apple TrueType) fejléc → font", () => {
    expect(detectKind(text('true'))).toBe('font');
  });

  it.each([['M4A '], ['m4b '], ['M4P '], ['aac ']])('ftyp audio-brand %p (szóköz-kitöltéssel) → audio', (brand) => {
    expect(detectKind(ftyp(brand))).toBe('audio');
  });

  it.each([['heic'], ['heix'], ['heim'], ['heis'], ['hevc'], ['mif1'], ['msf1'], ['avif']])(
    'ftyp kép-brand %s → image',
    (brand) => {
      expect(detectKind(ftyp(brand))).toBe('image');
    }
  );

  it.each([['isom'], ['mp42'], ['qt  '], ['M4V '], ['xxxx']])('ftyp egyéb brand %p → video', (brand) => {
    expect(detectKind(ftyp(brand))).toBe('video');
  });
});

describe('mediaPolicy — detectKind: egy bájttal eltérő „majdnem-fejléc” → null', () => {
  it.each([
    // JPEG FF D8 FF — bármelyik bájt hiányzik (D8 & E0 ≠ E0, így MP3-szinkron sem)
    ['JPEG 3. bájt', [0xff, 0xd8, 0x00]],
    ['JPEG 2. bájt', [0xff, 0x00, 0xff]],
    ['JPEG 1. bájt', [0x00, 0xd8, 0xff]],
    // PNG 89 50 4E 47
    ['PNG 4. bájt', [0x89, 0x50, 0x4e, 0x00]],
    ['PNG 3. bájt', [0x89, 0x50, 0x00, 0x47]],
    ['PNG 2. bájt', [0x89, 0x00, 0x4e, 0x47]],
    ['PNG 1. bájt', [0x00, 0x50, 0x4e, 0x47]],
    // BMP 42 4D
    ['BMP 2. bájt', [0x42, 0x00]],
    ['BMP 1. bájt', [0x00, 0x4d]],
    // TTF 00 01 00 00
    ['TTF 4. bájt', [0x00, 0x01, 0x00, 0x05]],
    ['TTF 3. bájt', [0x00, 0x01, 0x05, 0x00]],
    ['TTF 2. bájt', [0x00, 0x05, 0x00, 0x00]],
    ['TTF 1. bájt', [0x05, 0x01, 0x00, 0x00]],
    // Matroska 1A 45 DF A3
    ['MKV 4. bájt', [0x1a, 0x45, 0xdf, 0x00]],
    ['MKV 3. bájt', [0x1a, 0x45, 0x00, 0xa3]],
    ['MKV 2. bájt', [0x1a, 0x00, 0xdf, 0xa3]],
    ['MKV 1. bájt', [0x00, 0x45, 0xdf, 0xa3]],
    // MP3 frame-sync FF Ex
    ['MP3-szinkron 2. bájt', [0xff, 0x00]],
    ['MP3-szinkron 1. bájt', [0x12, 0xe0]],
  ])('%s → null', (_label, arr) => {
    expect(detectKind(bytes(arr))).toBeNull();
  });

  it.each([
    ['RIFF + ismeretlen forma (AVI)', text('RIFF', 'AVI ')],
    ['WEBP forma RIFF nélkül', text('XXXX', 'WEBP')],
    ['WAVE forma RIFF nélkül', text('XXXX', 'WAVE')],
    ['8BP (rövidített PSD)', text('8BP')],
    ['OTT (rövidített OTF)', text('OTT')],
  ])('%s → null', (_label, buf) => {
    expect(detectKind(buf)).toBeNull();
  });
});

describe('mediaPolicy — profilok: minden engedett kiterjesztés átmegy a saját tartalmával', () => {
  /** kiterjesztés → a hozzá tartozó valódi fejléc */
  const HEADER_FOR = {
    jpg: H.jpeg,
    jpeg: H.jpeg,
    png: H.png,
    webp: H.webp,
    heic: H.heic,
    heif: H.heic,
    gif: H.gif,
    bmp: H.bmp,
    psd: H.psd,
    psb: H.psd,
    pdf: H.pdf,
    ttf: H.ttf,
    otf: H.otf,
    mp4: H.mp4,
    mov: H.mp4,
    m4v: H.mp4,
    webm: H.webm,
    mkv: H.webm,
    mp3: H.mp3,
    m4a: H.m4a,
    aac: H.aac,
    wav: H.wav,
    ogg: H.ogg,
    flac: H.flac,
  };
  const KIND_FOR = {
    jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', heic: 'image', heif: 'image', gif: 'image', bmp: 'image',
    psd: 'image', psb: 'image', pdf: 'document', ttf: 'font', otf: 'font',
    mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video',
    mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
  };
  // explicit tábla (nem a lista visszaolvasása): profil → engedett kiterjesztések
  const TABLE = [
    ['image', ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp']],
    ['psd', ['psd', 'psb']],
    ['pdf', ['pdf']],
    ['imagedoc', ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'ttf', 'otf']],
    ['video', ['mp4', 'mov', 'm4v', 'webm', 'mkv']],
    ['audio', ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac']],
    ['media', ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'mp4', 'mov', 'm4v', 'webm', 'mp3', 'm4a', 'aac', 'wav']],
  ];
  const CASES = TABLE.flatMap(([profile, exts]) => exts.map((ext) => [profile, ext]));

  it.each(CASES)('%s profil: .%s → ok, a tartalom kindjával', (profile, ext) => {
    const r = validateFile({ originalname: `file.${ext}`, size: 1000 }, HEADER_FOR[ext], profileFor(profile));
    expect(r).toEqual({ ok: true, kind: KIND_FOR[ext] });
  });

  it.each([
    ['image', 'psd'],
    ['image', 'mp4'],
    ['psd', 'png'],
    ['pdf', 'png'],
    ['imagedoc', 'mp4'],
    ['video', 'mp3'],
    ['video', 'png'],
    ['audio', 'mp4'],
    ['media', 'mkv'],
    ['media', 'ogg'],
    ['media', 'flac'],
    ['media', 'pdf'],
    ['media', 'psd'],
  ])('%s profil: .%s → 415, pontos üzenettel', (profile, ext) => {
    const r = validateFile({ originalname: `file.${ext}`, size: 1000 }, HEADER_FOR[ext], profileFor(profile));
    expect(r).toEqual({ ok: false, status: 415, error: `Nem engedett kiterjesztés: .${ext}` });
  });

  it('a profilok pontos méret-/darab-korlátai', () => {
    const limits = Object.fromEntries(
      Object.entries(MEDIA_PROFILES).map(([k, p]) => [k, [p.maxBytes / MB, p.maxCount, p.kinds.join('/')]])
    );
    expect(limits).toEqual({
      image: [40, 8, 'image'],
      psd: [40, 1, 'image'],
      pdf: [40, 1, 'document'],
      imagedoc: [40, 400, 'image/font'],
      video: [500, 1, 'video'],
      audio: [100, 8, 'audio'],
      media: [500, 12, 'image/video/audio'],
    });
  });

  it('ismeretlen profil-név → media profil', () => {
    expect(profileFor('nincs-ilyen')).toBe(MEDIA_PROFILES.media);
  });
});

describe('mediaPolicy — validateFile: méret-határ pontosan a limitnél', () => {
  it.each([
    ['image', 'png', 40],
    ['psd', 'psd', 40],
    ['pdf', 'pdf', 40],
    ['imagedoc', 'png', 40],
    ['video', 'mp4', 500],
    ['audio', 'wav', 100],
    ['media', 'mp4', 500],
  ])('%s: pont %s MB → ok, +1 bájt → 413 pontos üzenettel', (profile, ext, maxMb) => {
    const header = { png: H.png, psd: H.psd, pdf: H.pdf, mp4: H.mp4, wav: H.wav }[ext];
    const p = profileFor(profile);
    expect(validateFile({ originalname: `f.${ext}`, size: maxMb * MB }, header, p)).toMatchObject({ ok: true });
    expect(validateFile({ originalname: `f.${ext}`, size: maxMb * MB + 1 }, header, p)).toEqual({
      ok: false,
      status: 413,
      error: `Túl nagy fájl (${maxMb}MB > ${maxMb}MB).`,
    });
  });

  it('a túl-nagy üzenet MB-ra kerekít', () => {
    expect(validateFile({ originalname: 'big.png', size: 41 * MB }, H.png, profileFor('image'))).toEqual({
      ok: false,
      status: 413,
      error: 'Túl nagy fájl (41MB > 40MB).',
    });
  });

  it('nem szám méret (pl. string) → a méret-ellenőrzés kimarad', () => {
    const r = validateFile({ originalname: 'a.png', size: /** @type {any} */ ('999999999999') }, H.png, profileFor('image'));
    expect(r).toEqual({ ok: true, kind: 'image' });
  });
});

describe('mediaPolicy — validateFile: pontos hibaüzenetek', () => {
  const img = profileFor('image');

  it.each([['a..b.png'], ['dir/a.png'], ['dir\\a.png'], ['a\0.png']])('gyanús név %p → 400', (name) => {
    expect(validateFile({ originalname: name, size: 10 }, H.png, img)).toEqual({
      ok: false,
      status: 400,
      error: `Érvénytelen fájlnév: ${name}`,
    });
  });

  it('nem-média tartalom → 415, a névvel', () => {
    expect(validateFile({ originalname: 'x.png', size: 10 }, bytes([0x4d, 0x5a]), img)).toEqual({
      ok: false,
      status: 415,
      error: 'Ismeretlen vagy nem-média tartalom: x.png',
    });
  });

  it('név nélküli, nem-média tartalom → üres névvel jelzett hiba', () => {
    expect(validateFile({ size: 10 }, bytes([0x4d, 0x5a]), img)).toEqual({
      ok: false,
      status: 415,
      error: 'Ismeretlen vagy nem-média tartalom: ',
    });
  });

  it('név nélküli valódi PNG → ok (a magic-byte dönt)', () => {
    expect(validateFile({ size: 10 }, H.png, img)).toEqual({ ok: true, kind: 'image' });
  });

  it('kind-eltérés egy-kindos profilon → pontos üzenet', () => {
    expect(validateFile({ originalname: 'clip.png', size: 10 }, H.mp4, img)).toEqual({
      ok: false,
      status: 415,
      error: 'A tartalom (video) nem egyezik a várttal (image).',
    });
  });

  it('kind-eltérés több-kindos profilon → a kindek /-rel összefűzve', () => {
    expect(validateFile({ originalname: 'doc', size: 10 }, H.pdf, profileFor('media'))).toEqual({
      ok: false,
      status: 415,
      error: 'A tartalom (document) nem egyezik a várttal (image/video/audio).',
    });
  });

  it('PSD-tartalom a psd profilon → ok, de a video profilon → kind-eltérés', () => {
    expect(validateFile({ originalname: 'layers', size: 10 }, H.psd, profileFor('psd'))).toEqual({ ok: true, kind: 'image' });
    expect(validateFile({ originalname: 'layers', size: 10 }, H.psd, profileFor('video'))).toEqual({
      ok: false,
      status: 415,
      error: 'A tartalom (image) nem egyezik a várttal (video).',
    });
  });
});

describe('mediaPolicy — imagedoc szöveges .cube', () => {
  const doc = profileFor('imagedoc');

  it('szöveges .cube → { ok, kind: text }', () => {
    expect(validateFile({ originalname: 'look.cube', size: 100 }, Buffer.from('TITLE "x"\nLUT_3D_SIZE 2\n'), doc)).toEqual({
      ok: true,
      kind: 'text',
    });
  });

  it('bináris (0-bájtos) .cube → 415 pontos üzenettel', () => {
    expect(validateFile({ originalname: 'look.cube', size: 100 }, bytes([0x41, 0x00]), doc)).toEqual({
      ok: false,
      status: 415,
      error: 'Bináris tartalom szövegfájlként: look.cube',
    });
  });

  it('.cube az image profilon nem engedett', () => {
    expect(validateFile({ originalname: 'look.cube', size: 100 }, Buffer.from('LUT'), profileFor('image'))).toEqual({
      ok: false,
      status: 415,
      error: 'Nem engedett kiterjesztés: .cube',
    });
  });
});

describe('mediaPolicy — validateUploads: pontos üzenetek', () => {
  it.each([[[]], [null], [undefined], ['nem tömb']])('üres / nem-tömb (%p) → 400', (files) => {
    expect(validateUploads(/** @type {any} */ (files), 'image')).toEqual({
      ok: false,
      status: 400,
      error: 'Nincs feltöltött fájl.',
    });
  });

  it('imagedoc: üres feltöltés megengedett → { ok: true }', () => {
    expect(validateUploads([], 'imagedoc')).toEqual({ ok: true });
    expect(validateUploads(/** @type {any} */ (null), 'imagedoc')).toEqual({ ok: true });
  });

  it('darabszám-határ: 8 kép ok, 9 → 413 pontos üzenettel', () => {
    const one = { originalname: 'a.png', size: 10, header: H.png };
    expect(validateUploads(Array(8).fill(one), 'image')).toEqual({ ok: true });
    expect(validateUploads(Array(9).fill(one), 'image')).toEqual({
      ok: false,
      status: 413,
      error: 'Túl sok fájl (9 > 8).',
    });
  });
});

describe('mediaPolicy — extOf / aktív tartalom', () => {
  it('a kiterjesztés körüli szóköz levágva, kisbetűsítve', () => {
    expect(extOf('  video.MP4  ')).toBe('mp4');
    expect(extOf('clip.mov\n')).toBe('mov');
  });

  it.each([[null], [undefined], [''], ['noext']])('kiterjesztés nélkül (%p) → üres', (name) => {
    expect(extOf(name)).toBe('');
  });

  it.each([['html'], ['htm'], ['xhtml'], ['svg'], ['xml'], ['js'], ['mjs']])(
    '.%s aktív tartalom: elutasítva és .bin-ként tárolva',
    (ext) => {
      expect(isActiveContent(`page.${ext}`, null)).toBe(true);
      expect(safeExt(`page.${ext}`)).toBe('.bin');
    }
  );

  it('fejléc nélkül (null) ártalmatlan név → nem aktív, nem dob', () => {
    expect(isActiveContent('a.txt', null)).toBe(false);
    expect(isActiveContent(undefined, undefined)).toBe(false);
  });

  it('ártalmatlan kiterjesztés megmarad', () => {
    expect(isActiveContent('photo.png', H.png)).toBe(false);
    expect(safeExt('photo.PNG')).toBe('.png');
  });

  it('az aktív fejléc CSAK a fájl elején (vezető szóköz után) számít', () => {
    expect(isActiveContent('a.txt', Buffer.from('  <svg xmlns="x">'))).toBe(true);
    expect(isActiveContent('a.txt', Buffer.from('hello <script>alert(1)</script>'))).toBe(false);
    expect(isActiveContent('a.txt', Buffer.from('note: <!doctype html>'))).toBe(false);
  });

  it('safeContentType: csak egyező kliens-MIME marad', () => {
    expect(safeContentType('image/png', H.png)).toBe('image/png');
    expect(safeContentType('video/mp4', H.png)).toBe('application/octet-stream');
    expect(safeContentType(undefined, H.png)).toBe('application/octet-stream');
  });
});
