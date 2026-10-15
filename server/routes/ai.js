// 🤖 AI-worker route-ok (hooks / probe / translate / highlights / story /
// thumbheadlines / captionstudio / assist / autoedit).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből
// — a viselkedés változatlan. FONTOS: az `authenticated({ method, path, rateClass })`
// hívások a router betöltésekor futnak → a routeInventory() ugyanazokkal a route-okkal
// és policy-/rate-osztállyal töltődik fel (a /health/routes leltár változatlan).

const express = require('express');

const { authenticated } = require('../security/authorization');
const { rateLimit } = require('../security/rateLimit');
const { proOnly, aiMeter } = require('../lib/guards');
const {
  sanitizeAiConfig,
  probeProvider,
  runHookGenerator,
  runTranslateCaptions,
  runHighlights,
  runStoryEngine,
  runThumbHeadlines,
  runCaptionStudio,
  runAssistant,
  runAutoEdit,
} = require('../ai');

const router = express.Router();

// 🪝 Hook Generator (P2): téma → 6 különböző stílusú nyitómondat
router.post('/ai/hooks', express.json({ limit: '256kb' }), ...authenticated({ method: 'POST', path: '/ai/hooks', rateClass: 'ai' }), rateLimit('ai'), aiMeter, (req, res) => {
  const { summary, aiConfig } = req.body ?? {};
  if (!summary || typeof summary !== 'string') {
    res.status(400).json({ error: 'Hiányzó összefoglaló.' });
    return;
  }
  runHookGenerator(summary.slice(0, 2000), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Hook hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🟢 Provider-health: elérhető-e a modell végpontja (a karakter-picker bogyójához)
router.post('/ai/probe', express.json({ limit: '64kb' }), ...authenticated({ method: 'POST', path: '/ai/probe', rateClass: 'ai' }), rateLimit('ai'), (req, res) => {
  const cfg = sanitizeAiConfig(req.body?.aiConfig);
  if (!cfg) {
    res.json({ ok: false });
    return;
  }
  probeProvider(cfg)
    .then((ok) => res.json({ ok }))
    .catch(() => res.json({ ok: false }));
});

// 🌍 Felirat-fordítás (Phase 4.2): szegmensek + célnyelv → fordított szegmensek
router.post('/ai/translate', express.json({ limit: '512kb' }), ...proOnly, rateLimit('ai'), aiMeter, (req, res) => {
  const { segments, lang, aiConfig } = req.body ?? {};
  if (!Array.isArray(segments) || segments.length === 0 || !lang) {
    res.status(400).json({ error: 'Hiányzó szegmensek vagy célnyelv.' });
    return;
  }
  runTranslateCaptions(segments.slice(0, 200), String(lang).slice(0, 40), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Translate hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎯 Highlights (Phase 3.3): long-form → több önálló short-jelölt (idő-ablak)
router.post('/ai/highlights', express.json({ limit: '512kb' }), ...proOnly, rateLimit('ai'), aiMeter, (req, res) => {
  const { context, aiConfig } = req.body ?? {};
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'Hiányzó kontextus.' });
    return;
  }
  runHighlights(context, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Highlights hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎬 Story Engine (Phase 1.1): jelek (hossz + átirat) → dramaturgiai fejezetek
router.post('/ai/story', express.json({ limit: '512kb' }), ...proOnly, rateLimit('ai'), aiMeter, (req, res) => {
  const { context, aiConfig } = req.body ?? {};
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'Hiányzó kontextus.' });
    return;
  }
  runStoryEngine(context, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('Story hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// 🎬 Thumbnail headline-javaslatok (CC V2): téma-összefoglaló → 3 rövid cím
router.post('/ai/thumbheadlines', express.json({ limit: '256kb' }), ...authenticated({ method: 'POST', path: '/ai/thumbheadlines', rateClass: 'ai' }), rateLimit('ai'), aiMeter, (req, res) => {
  const { summary, aiConfig } = req.body ?? {};
  if (!summary || typeof summary !== 'string') {
    res.status(400).json({ error: 'Hiányzó összefoglaló.' });
    return;
  }
  runThumbHeadlines(summary.slice(0, 2000), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('ThumbHeadline hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// ✨ Caption Studio (P1): kiemelt szavak + emoji a felirat-szegmensekhez
router.post('/ai/captionstudio', express.json({ limit: '1mb' }), ...authenticated({ method: 'POST', path: '/ai/captionstudio', rateClass: 'ai' }), rateLimit('ai'), aiMeter, (req, res) => {
  const { segments, aiConfig } = req.body ?? {};
  if (!Array.isArray(segments) || segments.length === 0) {
    res.status(400).json({ error: 'Hiányzó szegmensek.' });
    return;
  }
  runCaptionStudio(segments.slice(0, 60), sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('CaptionStudio hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// AI-asszisztens: kontextus + utasítás → validált parancslista
router.post('/ai/assist', express.json({ limit: '2mb' }), ...authenticated({ method: 'POST', path: '/ai/assist', rateClass: 'ai' }), rateLimit('ai'), aiMeter, (req, res) => {
  const { context, instruction, aiConfig } = req.body ?? {};
  if (!instruction || typeof instruction !== 'string') {
    res.status(400).json({ error: 'Hiányzó utasítás.' });
    return;
  }
  runAssistant(context ?? {}, instruction, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('AI hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// AI Edit Engine (P0-1): elemzett jelek → 3 vágás-változat
router.post('/ai/autoedit', express.json({ limit: '2mb' }), ...proOnly, rateLimit('ai'), aiMeter, (req, res) => {
  const { context, aiConfig } = req.body ?? {};
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'Hiányzó kontextus.' });
    return;
  }
  runAutoEdit(context, sanitizeAiConfig(aiConfig))
    .then((reply) => res.json(reply))
    .catch((err) => {
      console.error('AutoEdit hiba:', err.message);
      res.status(500).json({ error: err.message });
    });
});

module.exports = router;
