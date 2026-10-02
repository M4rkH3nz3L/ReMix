// 🧪 Média-upload policy (OWASP File Upload Cheat Sheet + API4).
//
// A worker ma globális `upload.any()`-vel fogad BÁRMIT (2 GB, típus-/darab-/
// tartalom-ellenőrzés nélkül). Ez upload-abuse + DoS felület. Ez a modul a
// TARTALOM alapján (magic-byte), NEM a kiterjesztés vagy a kliens-MIME alapján
// dönt — az utóbbiak hazudhatnak (`.png` névre `.exe` tartalom).
//
// A mag PURE (buffer + leíró → döntés), így determinisztikusan tesztelhető; a
// `mediaGuard(kind)` middleware (uploadPolicy használja) a lemezről olvassa az
// első bájtokat és ezt hívja.

// ───────────────────────────────────────────────── magic-byte detektálás

/** egy buffer kezdő-bájtjaiból a médiatípus: 'image' | 'video' | 'audio' | null */
function detectKind(buf) {
  if (!buf || buf.length < 12) {
    return null;
  }
  const b = buf;
  const ascii = (start, len) => b.slice(start, start + len).toString('latin1');

  // --- kép ---
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image'; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'; // PNG
  if (ascii(0, 4) === 'GIF8') return 'image'; // GIF
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image'; // WEBP
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image'; // BMP

  // --- RIFF/WAVE audio ---
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio'; // WAV

  // --- ISO-BMFF (ftyp): mp4/mov/m4a/heic — a BRAND dönti el a kind-ot ---
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).trim().toLowerCase();
    const audioBrands = ['m4a', 'm4b', 'm4p', 'aac'];
    const imageBrands = ['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1', 'avif'];
    if (audioBrands.includes(brand)) return 'audio';
    if (imageBrands.includes(brand)) return 'image';
    // isom/mp41/mp42/iso2/avc1/qt/M4V/dash/… → videó
    return 'video';
  }

  // --- Matroska / WebM ---
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video';

  // --- audio ---
  if (ascii(0, 3) === 'ID3') return 'audio'; // MP3 ID3
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync (MP3) vagy ADTS AAC (0xFFFx)
    return 'audio';
  }
  if (ascii(0, 4) === 'OggS') return 'audio'; // OGG
  if (ascii(0, 4) === 'fLaC') return 'audio'; // FLAC

  return null;
}

// ───────────────────────────────────────────────── profilok

const MB = 1024 * 1024;

/**
 * Endpoint-profilok: milyen kiterjesztés + melyik média-kind engedett, mekkora
 * a max fájlméret és darab. A `kinds` a detektált tartalom-kinddel kell egyezzen.
 */
const MEDIA_PROFILES = {
  image: { exts: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'], kinds: ['image'], maxBytes: 40 * MB, maxCount: 8 },
  video: { exts: ['mp4', 'mov', 'm4v', 'webm', 'mkv'], kinds: ['video'], maxBytes: 500 * MB, maxCount: 1 },
  audio: { exts: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'], kinds: ['audio'], maxBytes: 100 * MB, maxCount: 8 },
  // vegyes média (pl. thumbnails/compose: kép + opcionális overlay)
  media: {
    exts: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'mp4', 'mov', 'm4v', 'webm', 'mp3', 'm4a', 'aac', 'wav'],
    kinds: ['image', 'video', 'audio'],
    maxBytes: 500 * MB,
    maxCount: 12,
  },
};

function profileFor(kind) {
  return MEDIA_PROFILES[kind] || MEDIA_PROFILES.media;
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

// ───────────────────────────────────────────────── validáció (pure)

/**
 * Egy fájl ellenőrzése a profil ellen. `file`: { originalname, size }, `header`:
 * az első bájtok buffere (a magic-byte-hoz). @returns {{ok, status?, error?}}
 */
function validateFile(file, header, profile) {
  const name = file.originalname || '';
  // 1) path-traversal / gyanús fájlnév
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return { ok: false, status: 400, error: `Érvénytelen fájlnév: ${name}` };
  }
  // 2) kiterjesztés-allowlist — TOLERÁNS a hiányzó kiterjesztésre (akkor a
  //    magic-byte dönt, nehogy egy szokatlan nevű, de valódi médiát elutasítsunk);
  //    EXPLICIT, de nem engedett kiterjesztés (pl. .exe) viszont tiltott
  const ext = extOf(name);
  if (ext && !profile.exts.includes(ext)) {
    return { ok: false, status: 415, error: `Nem engedett kiterjesztés: .${ext}` };
  }
  // 3) méret
  if (typeof file.size === 'number' && file.size > profile.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Túl nagy fájl (${Math.round(file.size / MB)}MB > ${Math.round(profile.maxBytes / MB)}MB).`,
    };
  }
  // 4) magic-byte: a TARTALOM média-kindje egyezzen a profillal (a kiterjesztésre
  //    és a kliens-MIME-re SOHA nem bízunk semmit)
  const kind = detectKind(header);
  if (kind === null) {
    return { ok: false, status: 415, error: `Ismeretlen vagy nem-média tartalom: ${name}` };
  }
  if (!profile.kinds.includes(kind)) {
    return { ok: false, status: 415, error: `A tartalom (${kind}) nem egyezik a várttal (${profile.kinds.join('/')}).` };
  }
  return { ok: true, kind };
}

/**
 * Több fájl ellenőrzése egy profil ellen. `files`: [{ originalname, size, header }].
 * Darabszám + fájlonkénti validáció. @returns {{ok, status?, error?}}
 */
function validateUploads(files, kind) {
  const profile = profileFor(kind);
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return { ok: false, status: 400, error: 'Nincs feltöltött fájl.' };
  }
  if (list.length > profile.maxCount) {
    return { ok: false, status: 413, error: `Túl sok fájl (${list.length} > ${profile.maxCount}).` };
  }
  for (const f of list) {
    const r = validateFile(f, f.header, profile);
    if (!r.ok) {
      return r;
    }
  }
  return { ok: true };
}

module.exports = {
  detectKind,
  validateFile,
  validateUploads,
  profileFor,
  extOf,
  MEDIA_PROFILES,
};
