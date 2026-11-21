// 🖼️ Kép-eszköz route-ok (imagedoc/svg-pdf/color/text/bgremove/stickers3d/depth).
//
// Domain-router (01-api-architecture §01.1). A handlerek SZÓ SZERINT az index.js-ből —
// kép-rasterizálás/elemzés/ONNX; a viselkedés (watermark/tier/404-precedencia) változatlan.
//
// REFACTOR: a handlerek a routes/imageToolsLib/ alatt (render / interop (PSD-PDF) / szín / asset), a
// segédek mellettük (remoteMediaOpts, pdfRaster). ITT marad a route-tábla: ugyanazok az útvonalak, ugyanabban
// a sorrendben, ugyanazzal a middleware-lánccal (auth → rate-limit → feltöltés → mediaGuard).

const express = require('express');

const { requireAuth } = require('../auth');
const { proOnly } = require('../lib/guards');
const { rateLimit } = require('../security/rateLimit');
const { mediaGuard } = require('../security/uploadPolicy');
const { upload, uploadImage, uploadSvg } = require('../lib/upload');
const { imageDocHandler, svgPdfHandler } = require('./imageToolsLib/renderHandlers');
const { psdImportHandler, pdfImportHandler, psdExportHandler } = require('./imageToolsLib/interopHandlers');
const {
  colorStatsHandler,
  colorPixelHandler,
  lutExportHandler,
  colorScopeHandler,
  textBakeHandler,
} = require('./imageToolsLib/colorHandlers');
const {
  bgRemoveHandler,
  bgRemoveFileHandler,
  stickers3dListHandler,
  sticker3dPngHandler,
  depthParallaxHandler,
  depthFocusHandler,
  depthFileHandler,
} = require('./imageToolsLib/assetHandlers');

const router = express.Router();

router.post('/imagedoc', requireAuth, rateLimit('analysis'), uploadImage.any(), mediaGuard('imagedoc'), imageDocHandler);
router.post('/psd/import', ...proOnly, uploadImage.any(), mediaGuard('psd'), psdImportHandler);
router.post('/pdf/import', ...proOnly, uploadImage.any(), mediaGuard('pdf'), pdfImportHandler);
router.post('/psd/export', ...proOnly, uploadImage.any(), mediaGuard('imagedoc'), psdExportHandler);
router.post('/svg/pdf', requireAuth, rateLimit('analysis'), uploadSvg.any(), svgPdfHandler);
router.post('/color/stats', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('image'), colorStatsHandler);
router.post('/color/pixel', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('image'), colorPixelHandler);
router.post('/color/lut-export', express.json({ limit: '256kb' }), requireAuth, rateLimit('analysis'), lutExportHandler);
router.post('/color/scope', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('image'), colorScopeHandler);
router.post('/text/bake', express.json({ limit: '256kb' }), requireAuth, rateLimit('analysis'), textBakeHandler);
router.post('/bgremove', ...proOnly, upload.any(), mediaGuard('image'), bgRemoveHandler);
router.get('/bgremove/:id/:name', requireAuth, bgRemoveFileHandler);
router.get('/stickers3d', stickers3dListHandler);
router.get('/stickers3d/:id.png', sticker3dPngHandler);
router.post('/depth/parallax', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('image'), depthParallaxHandler);
router.post('/depth/focus', requireAuth, rateLimit('analysis'), upload.any(), mediaGuard('image'), depthFocusHandler);
router.get('/depth/:id/:name', requireAuth, depthFileHandler);

module.exports = router;
