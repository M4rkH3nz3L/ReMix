const { logCaught } = require('../lib/caught');
// 🗂️ ReMix Storage — az S3/R2-backend (élesben Cloudflare R2; privát files-bucket).
const fs = require('fs');

const s3 = require('../s3store');
const { MARKER, MAX_TREE } = require('./constants');
const { md5OfFile } = require('./md5');

function s3Backend() {
  const sdk = require('@aws-sdk/client-s3');
  const send = (cmd) => s3.client().send(cmd);
  // 🔒 a user-fájlok SAJÁT (privát, publikus domain nélküli) bucketbe mehetnek — ugyanaz
  // az R2-fiók/kulcs; hiányában a közös média-bucket (amin publikus r2.dev domain lehet)
  const Bucket = filesBucket();
  const isMissing = (err) => err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
  return {
    kind: 's3',
    async list(prefix) {
      const folders = [];
      const files = [];
      let token;
      do {
        const page = await send(
          new sdk.ListObjectsV2Command({ Bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token, MaxKeys: 1000 })
        );
        for (const cp of page.CommonPrefixes ?? []) {
          const name = (cp.Prefix ?? '').slice(prefix.length).replace(/\/$/, '');
          if (name) {
            folders.push(name);
          }
        }
        for (const obj of page.Contents ?? []) {
          const name = (obj.Key ?? '').slice(prefix.length);
          if (name && name !== MARKER) {
            files.push({
              name,
              size: Number(obj.Size || 0),
              modified: obj.LastModified ? new Date(obj.LastModified).toISOString() : null,
            });
          }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return { folders, files };
    },
    async listAll(prefix) {
      const out = [];
      let token;
      do {
        const page = await send(new sdk.ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const obj of page.Contents ?? []) {
          out.push({ key: obj.Key, size: Number(obj.Size || 0) });
        }
        token = page.IsTruncated && out.length <= MAX_TREE ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async head(key) {
      try {
        const r = await send(new sdk.HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: Number(r.ContentLength || 0),
          modified: r.LastModified ? new Date(r.LastModified).toISOString() : null,
          // egyrészes PUT-nál az ETag = a tartalom MD5-je (R2-n is)
          etag: String(r.ETag || '').replace(/"/g, ''),
        };
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    async put(key, localPath, contentType) {
      await send(
        new sdk.PutObjectCommand({
          Bucket,
          Key: key,
          Body: fs.createReadStream(localPath),
          ContentLength: fs.statSync(localPath).size,
          ContentType: contentType || 'application/octet-stream',
        })
      );
    },
    async putEmpty(key) {
      await send(new sdk.PutObjectCommand({ Bucket, Key: key, Body: '', ContentLength: 0 }));
    },
    async remove(key) {
      await send(new sdk.DeleteObjectCommand({ Bucket, Key: key }));
    },
    async copy(from, to) {
      const src = `${Bucket}/${from.split('/').map(encodeURIComponent).join('/')}`;
      await send(new sdk.CopyObjectCommand({ Bucket, Key: to, CopySource: src }));
    },
    async stream(key) {
      try {
        const r = await send(new sdk.GetObjectCommand({ Bucket, Key: key }));
        return { body: r.Body, size: Number(r.ContentLength || 0), contentType: r.ContentType || null };
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    async putText(key, text) {
      await send(
        new sdk.PutObjectCommand({ Bucket, Key: key, Body: text, ContentType: 'application/json', ContentLength: Buffer.byteLength(text) })
      );
    },
    async readText(key) {
      try {
        const r = await send(new sdk.GetObjectCommand({ Bucket, Key: key }));
        return await r.Body.transformToString();
      } catch (err) {
        if (isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    // multipart: valódi S3/R2 multipart-feltöltés (a darabokat az R2 tartja; ListParts a folytatáshoz)
    async mpInit(key, contentType) {
      const r = await send(
        new sdk.CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType || 'application/octet-stream' })
      );
      return r.UploadId;
    },
    async mpPart(key, id, partNumber, localPath) {
      const md5 = await md5OfFile(localPath);
      const r = await send(
        new sdk.UploadPartCommand({
          Bucket,
          Key: key,
          UploadId: id,
          PartNumber: partNumber,
          Body: fs.readFileSync(localPath),
          // a worker→R2 szakasz integritása: az R2 elutasítja, ha a darab sérült
          ContentMD5: Buffer.from(md5, 'hex').toString('base64'),
        })
      );
      return String(r.ETag || '').replace(/"/g, '');
    },
    async mpListParts(key, id) {
      try {
        const out = [];
        let marker;
        do {
          const r = await send(new sdk.ListPartsCommand({ Bucket, Key: key, UploadId: id, PartNumberMarker: marker }));
          for (const pt of r.Parts ?? []) {
            out.push({ partNumber: pt.PartNumber, size: Number(pt.Size || 0), etag: String(pt.ETag || '').replace(/"/g, '') });
          }
          marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
        } while (marker);
        return out;
      } catch (err) {
        if (err?.name === 'NoSuchUpload' || isMissing(err)) {
          return null;
        }
        throw err;
      }
    },
    async mpComplete(key, id, parts) {
      await send(
        new sdk.CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: id,
          MultipartUpload: { Parts: parts.map((pt) => ({ PartNumber: pt.partNumber, ETag: pt.etag })) },
        })
      );
    },
    async mpAbort(key, id) {
      await send(new sdk.AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: id })).catch((caught) => { logCaught('userFiles.js:mpAbort', caught); });
    },
  };
}

/** A user-fájlok bucketje: `S3_FILES_BUCKET` (privát), különben a közös `S3_BUCKET`. */
function filesBucket() {
  return (process.env.S3_FILES_BUCKET || '').trim() || s3.BUCKET;
}

module.exports = { s3Backend, filesBucket };
