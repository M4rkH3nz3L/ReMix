const { logCaught } = require('../lib/caught');
// ⬇️ Feed-videó letöltése (PRO-CASH 4.5, C2.5–C2.7, D1, D11). Domain-router (§01.1).
//
// GET /posts/:id/download — a szint a VERIFIKÁLT tokenből (a kliens kérése nem számít). A poszt
//   láthatóságát a DB `can_view_post` dönti el. Free-nek és mások posztjánál mindenkinek a
//   szerveren égetett vízjeles változat jár (az első kéréskor készül, utána gyorsítótárazva);
//   tisztát csak a fizetős tulajdonos kap a saját posztjáról. Válasz: rövid életű, aláírt link.
// GET /media/signed — az aláírt link kiszolgálója: a tár privát lehet, nyilvános link nélkül.
const fs = require('fs');
const express = require('express');
const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { adminClient } = require('../notify');
const { activeTier } = require('../billing');
const { downloadMedia, uploadMedia, serveMedia } = require('../mediastore');
const pd = require('../postDownload');

const router = express.Router();

// a vízjelezés drága → egy posztra egyszerre egy készüljön (a többi kérés megvárja)
const inFlight = new Map();

function publicBaseOf(req) {
  return (process.env.MEDIA_PUBLIC_BASE || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

async function ensureWatermarked(sb, post, sourceKey, base) {
  if (post.download_wm_key) {
    return post.download_wm_key;
  }
  if (inFlight.has(post.id)) {
    return inFlight.get(post.id);
  }
  const job = (async () => {
    const tmp = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'remix-dl-'));
    const src = require('path').join(tmp, 'src.mp4');
    try {
      await downloadMedia(sourceKey, src);
      const { output, dir } = await pd.burnWatermark(src, {
        username: post.creator_username || 'remix',
        postUrl: `${(process.env.WEB_BASE_URL || base).replace(/\/+$/, '')}/player/${post.id}`,
      });
      const key = pd.watermarkKeyFor(sourceKey);
      await uploadMedia(key, output, 'video/mp4', base);
      fs.rmSync(dir, { recursive: true, force: true });
      const { error } = await sb.from('posts').update({ download_wm_key: key }).eq('id', post.id);
      if (error) {
        throw new Error(error.message);
      }
      return key;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();
  inFlight.set(post.id, job);
  try {
    return await job;
  } finally {
    inFlight.delete(post.id);
  }
}

router.get('/posts/:id/download', requireAuth, rateLimit('render'), async (req, res) => {
  const uid = callerId(req, req.query.userId);
  const sb = adminClient();
  if (!uid) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!sb) {
    res.status(503).json({ error: 'storage_unavailable' });
    return;
  }
  const postId = String(req.params.id || '');
  try {
    const { data: visible } = await sb.rpc('can_view_post', { p_post: postId, p_user: uid });
    if (visible !== true) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { data: post } = await sb
      .from('posts')
      .select('id, creator_id, creator_username, title, video_url, allow_download, download_wm_key')
      .eq('id', postId)
      .maybeSingle();
    const sourceKey = post && pd.mediaKeyFromUrl(post.video_url);
    if (!post || !post.video_url || !sourceKey) {
      res.status(409).json({ error: 'not_rendered' });
      return;
    }
    const variant = pd.downloadVariant({
      tier: await activeTier(uid),
      isOwner: post.creator_id === uid,
      allowDownload: post.allow_download,
    });
    if (variant === 'forbidden') {
      res.status(403).json({ error: 'download_disabled' });
      return;
    }
    const base = publicBaseOf(req);
    let key = sourceKey;
    if (variant === 'watermarked') {
      try {
        key = await ensureWatermarked(sb, post, sourceKey, base);
      } catch (caught) {
        logCaught('routes/postDownload.js:watermark', caught);
        res.status(503).json({ error: 'watermark_unavailable' });
        return;
      }
    }
    const signed = pd.signMediaKey(key, 600);
    const safeTitle = String(post.title || 'remix').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'remix';
    res.json({
      url: `${base}${signed.path}&name=${encodeURIComponent(`${safeTitle}.mp4`)}`,
      variant,
      expiresAt: signed.expiresAt,
      filename: `${safeTitle}.mp4`,
    });
  } catch (err) {
    logCaught('routes/postDownload.js', err);
    res.status(500).json({ error: 'download_failed' });
  }
});

router.get('/media/signed', async (req, res) => {
  const key = String(req.query.key || '');
  if (!pd.verifyMediaSignature(key, req.query.exp, req.query.sig)) {
    res.status(403).json({ error: 'invalid_signature' });
    return;
  }
  try {
    const name = typeof req.query.name === 'string' ? req.query.name : null;
    const ok = await serveMedia(key, res, name);
    if (!ok && !res.headersSent) {
      res.status(404).json({ error: 'not_found' });
    }
  } catch (err) {
    logCaught('routes/postDownload.js:signed', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'serve_failed' });
    }
  }
});

module.exports = router;
