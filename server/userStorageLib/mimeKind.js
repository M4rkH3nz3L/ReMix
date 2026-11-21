// 🔌 Külső tárhely — MIME-típus → média-fajta (video/image/audio), különben null.
function mimeKind(mime) {
  if (/^video\//i.test(mime)) return 'video';
  if (/^image\//i.test(mime)) return 'image';
  if (/^audio\//i.test(mime)) return 'audio';
  return null;
}

module.exports = { mimeKind };
