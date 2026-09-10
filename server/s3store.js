// S3-kompatibilis tár a felhő-renderhez. Dev-ben a Supabase Storage S3-végpontja
// (STORAGE_S3_URL + S3_PROTOCOL kulcsok); élesben bármely S3 (AWS/R2/MinIO) — csak
// az env cserélődik. Env nélkül kikapcsolt → a render a lokális dev-úton megy.
const fs = require('fs');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const ENDPOINT = process.env.S3_ENDPOINT || '';
const BUCKET = process.env.S3_BUCKET || 'renders';
const REGION = process.env.S3_REGION || 'us-east-1';
const ACCESS = process.env.S3_ACCESS_KEY || '';
const SECRET = process.env.S3_SECRET_KEY || '';
// a publikus letöltő-URL bázisa (Supabase: .../storage/v1/object/public)
const PUBLIC_BASE = process.env.S3_PUBLIC_BASE || '';

function s3Enabled() {
  return Boolean(ENDPOINT && ACCESS && SECRET);
}

let cached;
function client() {
  if (!cached) {
    cached = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      forcePathStyle: true, // MinIO/Supabase path-style
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
  }
  return cached;
}

async function uploadFile(key, localPath, contentType) {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentLength: fs.statSync(localPath).size,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  return key;
}

async function downloadFile(key, localPath) {
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    res.Body.pipe(ws).on('finish', resolve).on('error', reject);
  });
  return localPath;
}

function publicUrl(key) {
  return PUBLIC_BASE ? `${PUBLIC_BASE}/${BUCKET}/${key}` : '';
}

module.exports = { s3Enabled, uploadFile, downloadFile, publicUrl, BUCKET };
