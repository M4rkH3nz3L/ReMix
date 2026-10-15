// 📚 Media-tar + zene route-ok (/library, /music + fajl-serve).
// Domain-router (01-api-architecture §01.1). SZO SZERINT az index.js-bol; a 30 mp-es
// cache-frissites a modul sajat, unref-elt intervallumaban (teszt-importkor artalmatlan).

const express = require('express');
const { listMediaLibrary } = require('../library');
const { listLibrary } = require('../sfx');

const router = express.Router();

let mediaLibCache = null;
router.get('/library', (_req, res) => {
  (mediaLibCache ? Promise.resolve(mediaLibCache) : listMediaLibrary())
    .then((items) => {
      mediaLibCache = items;
      res.json({
        entries: items.map(({ id, name, kind, duration, size }) => ({
          id,
          name,
          kind,
          duration,
          size,
          url: `/library/${encodeURIComponent(id)}/file`,
        })),
      });
    })
    .catch(() => res.status(500).json({ error: 'A médiatár nem olvasható.' }));
});

router.get('/library/:id/file', (req, res) => {
  (mediaLibCache ? Promise.resolve(mediaLibCache) : listMediaLibrary())
    .then((items) => {
      mediaLibCache = items;
      const item = items.find((t) => t.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Ismeretlen médiafájl.' });
        return;
      }
      res.sendFile(item.file);
    })
    .catch(() => res.status(500).json({ error: 'A médiatár nem olvasható.' }));
});

// hang-könyvtár: generált SFX-ek + a server/music mappa fájljai
let libraryCache = null;
router.get('/music', (_req, res) => {
  (libraryCache ? Promise.resolve(libraryCache) : listLibrary())
    .then((items) => {
      libraryCache = items;
      res.json({
        tracks: items.map(({ id, name, kind, duration, bpm, energy }) => ({
          id,
          name,
          kind,
          duration,
          // egységes metaadat minden trackre (videóhoz-illesztéshez)
          bpm: bpm ?? 0,
          energy: typeof energy === 'number' ? energy : 0.5,
          url: `/music/${encodeURIComponent(id)}/file`,
        })),
      });
    })
    .catch(() => res.status(500).json({ error: 'A könyvtár nem olvasható.' }));
});

router.get('/music/:id/file', (req, res) => {
  (libraryCache ? Promise.resolve(libraryCache) : listLibrary())
    .then((items) => {
      libraryCache = items;
      const item = items.find((t) => t.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Ismeretlen hang.' });
        return;
      }
      res.sendFile(item.file);
    })
    .catch(() => res.status(500).json({ error: 'A könyvtár nem olvasható.' }));
});

// a music/library mappa valtozhat futas kozben — a cache 30 mp-enkent frissul
setInterval(() => {
  libraryCache = null;
  mediaLibCache = null;
}, 30 * 1000).unref();

module.exports = router;
