// 🎚️ Hang-generáló route-ok (szintetizátor / dob-gép / sampler / spektrogram).
//
// Az ELSŐ domain-router (01-api-architecture §01.1): az index.js-ből SZÓ SZERINT
// átemelt handlerek — a viselkedés változatlan. Újdonság: (a) séma-validáció a
// handler ELŐTT (§01.2), (b) endpoint-profilú feltöltés-limit (`uploadAudio`
// 100 MB) a globális 2 GB blanket helyett (§01.5).

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const { renderSynth } = require('../synth');
const { renderDrums } = require('../drums');
const { renderSampler } = require('../sampler');
const { renderSpectrum } = require('../spectrum');
const { requireAuth } = require('../auth');
const { paidOnly } = require('../lib/guards');
const { uploadAudio } = require('../lib/upload');
const { validate, validateJsonField } = require('../lib/validate');
const { synthBody, drumsBody, samplerSteps } = require('./schemas/audioGen');

const router = express.Router();

// 🎹 Szintetizátor-render (AUDIOT §5): hangjegyek (MIDI) → generált hang. Szinkron.
router.post('/synth', express.json({ limit: '512kb' }), ...paidOnly, validate(synthBody), async (req, res) => {
  const notes = Array.isArray(req.body?.notes) ? req.body.notes : [];
  if (notes.length === 0) {
    res.status(400).json({ error: 'Nincs hangjegy.' });
    return;
  }
  const opts = { bpm: Number(req.body?.bpm) || 120, wave: req.body?.wave };
  const fmt = req.body?.format === 'wav' ? 'wav' : 'm4a';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-synth-'));
  const out = path.join(dir, `synth.${fmt}`);
  res.on('finish', () => fs.rm(dir, { recursive: true, force: true }, () => {}));
  try {
    const r = await renderSynth(notes, opts, out);
    res.setHeader('X-Duration-Sec', String(r.durationSec));
    res.sendFile(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 📊 Spektrogram (AUDIOT §7): feltöltött hangból frekvencia-kép → PNG. Elemző.
router.post('/audio/spectrum', uploadAudio.any(), requireAuth, async (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Nincs hang-fájl.' });
    return;
  }
  const opts = { width: Number(req.body?.width) || 720, height: Number(req.body?.height) || 360, mode: req.body?.mode };
  const out = path.join(req.workDir || os.tmpdir(), 'spectrum.png');
  res.on('finish', () => {
    if (req.workDir) {
      fs.rm(req.workDir, { recursive: true, force: true }, () => {});
    }
  });
  try {
    await renderSpectrum(file.path, opts, out);
    res.sendFile(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🎛️🔊 Sampler-render (AUDIOT §5): feltöltött minta a step-rács lépéseire. Multipart.
router.post('/sampler', uploadAudio.any(), ...paidOnly, validateJsonField('steps', samplerSteps), async (req, res) => {
  const file = (req.files ?? [])[0];
  if (!file) {
    res.status(400).json({ error: 'Nincs minta-fájl.' });
    return;
  }
  let steps = [];
  try {
    steps = JSON.parse(req.body?.steps ?? '[]');
  } catch {
    steps = [];
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    res.status(400).json({ error: 'Nincs lépés.' });
    if (req.workDir) {
      fs.rm(req.workDir, { recursive: true, force: true }, () => {});
    }
    return;
  }
  const opts = { bpm: Number(req.body?.bpm) || 120, bars: Number(req.body?.bars) || 1 };
  const fmt = req.body?.format === 'wav' ? 'wav' : 'm4a';
  const out = path.join(req.workDir || os.tmpdir(), `sampler.${fmt}`);
  res.on('finish', () => {
    if (req.workDir) {
      fs.rm(req.workDir, { recursive: true, force: true }, () => {});
    }
  });
  try {
    const r = await renderSampler(file.path, steps, opts, out);
    res.setHeader('X-Duration-Sec', String(r.durationSec));
    res.sendFile(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🥁 Dob-gép-render (AUDIOT §5): ütések (voice+step) → szintetizált dob-minta. Szinkron.
router.post('/drums', express.json({ limit: '512kb' }), ...paidOnly, validate(drumsBody), async (req, res) => {
  const hits = Array.isArray(req.body?.hits) ? req.body.hits : [];
  if (hits.length === 0) {
    res.status(400).json({ error: 'Nincs dob-ütés.' });
    return;
  }
  const opts = { bpm: Number(req.body?.bpm) || 120, bars: Number(req.body?.bars) || 1 };
  const fmt = req.body?.format === 'wav' ? 'wav' : 'm4a';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-drums-'));
  const out = path.join(dir, `drums.${fmt}`);
  res.on('finish', () => fs.rm(dir, { recursive: true, force: true }, () => {}));
  try {
    const r = await renderDrums(hits, opts, out);
    res.setHeader('X-Duration-Sec', String(r.durationSec));
    res.sendFile(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
