// 📼 LiveKit Egress — a VOD-felvétel (MP4 az S3-ba) neve, kulcsa, URL-je és output-ja.
const { EncodedFileOutput, EncodedFileType, S3Upload } = require('livekit-server-sdk');
const crypto = require('crypto');

// 📼 D158 — VOD az adás után. Ha az `EGRESS_VOD=1` + S3 konfigurált, az egress a
// stream MELLÉ egy MP4-et is ír az S3-ba (`live-vod/{room}.mp4`); az adás végén a
// kliens ebből csinál feed-posztot (publishLiveVod). A bizonyított stream-utat nem
// érinti: VOD nélkül az output marad a sima StreamOutput.
function vodEnabled() {
  return (
    process.env.EGRESS_VOD === '1' &&
    !!(process.env.S3_ACCESS_KEY || '').trim() &&
    !!(process.env.S3_SECRET_KEY || '').trim() &&
    !!(process.env.S3_BUCKET || '').trim()
  );
}

/** Az adott szoba VOD-jának S3-kulcsa (determinisztikus, a kliens is kiszámolja). */
/**
 * 🔐 L8: a VOD-objektum neve NEM kitalálható — a (nyilvánosan listázható) session-id mellé
 * egy egress-indításonként új, 96 bites véletlen tag kerül.
 */
function vodName(room) {
  return `${room}-${crypto.randomBytes(12).toString('hex')}`;
}

function vodKey(name) {
  return `live-vod/${name}.mp4`;
}

/** A VOD publikus URL-je (S3_PUBLIC_BASE), ha VOD aktív — különben null. */
function vodUrl(name) {
  if (!vodEnabled()) {
    return null;
  }
  const base = (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/, '');
  return base ? `${base}/${vodKey(name)}` : null;
}

/** EncodedFileOutput az S3-ba (MP4), vagy null, ha a VOD nincs bekapcsolva. */
function buildVodOutput(name) {
  if (!vodEnabled()) {
    return null;
  }
  const s3 = new S3Upload({
    accessKey: (process.env.S3_ACCESS_KEY || '').trim(),
    secret: (process.env.S3_SECRET_KEY || '').trim(),
    bucket: (process.env.S3_BUCKET || '').trim(),
    region: (process.env.S3_REGION || 'us-east-1').trim(),
    endpoint: (process.env.S3_ENDPOINT || '').trim() || undefined,
    forcePathStyle: !!(process.env.S3_ENDPOINT || '').trim(),
  });
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: vodKey(name),
    output: { case: 's3', value: s3 },
  });
}

module.exports = { vodEnabled, vodName, vodKey, vodUrl, buildVodOutput };
