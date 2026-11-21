// 🎬 Render route-ok + lokális job-állapot (render/proxy/collect/queue/:id*).
//
// Domain-router (01-api-architecture §01.1). A handlerek + a `jobs` in-memory map
// + a view/workerView/denyRenderJob helperek SZÓ SZERINT az index.js-ből — a BOLA-
// ellenőrzés (canAccessRenderJob → 404 idegen jobra), a kooperatív abort és a
// queue/local kettősség változatlan.
//
// REFACTOR: a kezelők a routes/renderLib/ alatt (beküldés / proxy+collect / sor-nézet / job-állapot), a közös
// job-tár a renderLib/jobStore.js-ben. ITT marad a route-tábla: ugyanazok az útvonalak, ugyanabban a
// sorrendben, ugyanazzal a middleware-lánccal (auth → rate-limit → feltöltés).

const express = require('express');

const { requireAuth } = require('../auth');
const { paidOnly, renderJobAuth } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { upload } = require('../lib/upload');
const { renderSubmitHandler } = require('./renderLib/submitHandler');
const { proxyHandler, collectHandler } = require('./renderLib/packageHandlers');
const { renderQueueHandler } = require('./renderLib/queueHandler');
const { renderStatusHandler, renderFileHandler, renderCancelHandler } = require('./renderLib/jobHandlers');

const router = express.Router();

router.post('/render', ...paidOnly, upload.any(), renderSubmitHandler);
router.post('/proxy', requireAuth, rateLimit('render'), upload.any(), proxyHandler);
router.post('/collect', requireAuth, rateLimit('render'), upload.any(), collectHandler);
router.get('/render/queue', requireAuth, renderQueueHandler);
router.get('/render/:id', renderJobAuth, renderStatusHandler);
router.get('/render/:id/file', renderJobAuth, renderFileHandler);
router.post('/render/:id/cancel', renderJobAuth, renderCancelHandler);

module.exports = router;
