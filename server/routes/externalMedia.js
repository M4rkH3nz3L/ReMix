// 🔗 Külső média route-ok (YouTube/URL-import + TTS voiceover).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből.

const fs = require('fs');
const express = require('express');

const { callerId } = require('../auth');
const { proOnly } = require('../lib/guards');
const { ttsAvailable, synthesize, ttsFile, listVoices } = require('../tts');
const { ytAvailable, importMedia, youtubeFile } = require('../youtube');

const router = express.Router();

// 🔗 URL-import (YouTube stb.): teljes videó / csak hang / egy képkocka
router.post('/youtube', express.json({ limit: '8kb' }), ...proOnly, async (req, res) => {
  if (!ytAvailable()) {
    res.status(501).json({ error: 'A yt-dlp nincs telepítve a workeren (brew install yt-dlp).' });
    return;
  }
  try {
    const { url, kind, atSec } = req.body || {};
    res.json(await importMedia(url, kind, atSec));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/youtube/:id/:name', (req, res) => {
  const file = youtubeFile(req.params.id, req.params.name);
  if (!file || !fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

// 🗣️ TTS (szöveg → beszéd): elérhető hangok, generálás, letöltés
router.get('/tts/voices', async (_req, res) => {
  res.json({ available: ttsAvailable(), voices: await listVoices() });
});
router.post('/tts', express.json({ limit: '256kb' }), ...proOnly, async (req, res) => {
  if (!ttsAvailable()) {
    res.status(501).json({ error: 'A TTS csak macOS dev-workeren érhető el.' });
    return;
  }
  try {
    // 📊 §2.2: havi kvóta-gate a `cloudJobs` metrikára (a hiteles tier a subscriptionből).
    // DB/tábla nélkül best-effort megenged; a könyvelés a siker után (best-effort).
    const uid = callerId(req, req.body?.userId);
    const gate = await enforceQuota(uid, await userTier(uid), 'cloudJobs', 1);
    if (!gate.ok) {
      res.status(429).json({ error: `Elérted a havi felhő-job kvótád. Hátralévő: ${gate.remaining}.` });
      return;
    }
    const { text, voice } = req.body || {};
    const result = await synthesize(text, voice);
    void trackUsage(uid, 'cloudJobs', 1);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/tts/:id/:name', (req, res) => {
  const file = ttsFile(req.params.id, req.params.name);
  if (!fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

module.exports = router;
