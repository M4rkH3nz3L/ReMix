const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const { callerId, requireAuth } = require('../auth');
const { rateLimit } = require('../security/rateLimit');
const { upload } = require('../lib/upload');
const { mediaStoreEnabled, uploadMedia, LOCAL_DIR } = require('../mediastore');
const { s3Enabled, deleteFile } = require('../s3store');

/**
 * 📲 Átviteli tár — eszköz→eszköz projekt-továbbítás felhő-előfizetés nélkül.
 *
 * NEM tárhely-termék, hanem TRANZIENS csatorna: projektenként EGY .rp csomag,
 * 24 órás TTL-lel. Ezért kvótán KÍVÜLI (a tartós tárolást a mediaBackup fedi),
 * de méret-plafonos (TRANSFER_MAX_BYTES, alap 2 GB) és rate-limitelt. A lejárt
 * csomagokat a következő feltöltés söpri (lazy TTL) — R2-n opcionális lifecycle
 * szabály a `transfer/` prefixre tovább egyszerűsíti. A sor (url+kulcs) a
 * `project_transfers` táblában él (RLS: saját) — a kliens onnan olvassa, a
 * letöltés a kitalálhatatlan (uuid-s) publikus URL-en megy, mint a feed-média.
 */

const router = express.Router();

const { TRANSFER_TTL_MS, isTransferExpired, sanitizeProjectId } = require('../lib/transfer');

const MAX_BYTES = Number(process.env.TRANSFER_MAX_BYTES || 2 * 1024 * 1024 * 1024);

// service-role kliens a sor-íráshoz (RLS fölött — a user-azonosítás a tokenből jött)
let adminClient = null;
function admin() {
  if (adminClient) {
    return adminClient;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  const { createClient } = require('@supabase/supabase-js');
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

/** objektum törlése a háttér-tárból (S3/R2 vagy lokális disk) — best-effort */
async function deleteObject(key) {
  try {
    if (s3Enabled()) {
      await deleteFile(key);
    } else {
      fs.rmSync(path.join(LOCAL_DIR, key), { force: true });
    }
  } catch {
    // az árva objektum a TTL/lifecycle alatt amúgy is elévül
  }
}

// 📤 csomag feltöltése (felülírja a projekt korábbi csomagját; söpri a lejártakat)
router.post('/transfer', upload.any(), requireAuth, rateLimit('upload'), async (req, res) => {
  const f = (req.files ?? [])[0];
  const cleanup = () => {
    try {
      if (f?.path) {
        fs.rmSync(f.path, { force: true });
      }
    } catch {
      /* temp-takarítás best-effort */
    }
  };
  try {
    const uid = callerId(req, req.body?.userId);
    const projectId = sanitizeProjectId(req.body?.projectId);
    if (!uid) {
      cleanup();
      res.status(401).json({ error: 'nincs hitelesítés' });
      return;
    }
    if (!projectId || !f) {
      cleanup();
      res.status(400).json({ error: 'projectId + .rp fájl kell' });
      return;
    }
    if (Number(f.size || 0) > MAX_BYTES) {
      cleanup();
      res.status(413).json({ error: 'túl nagy csomag', maxBytes: MAX_BYTES });
      return;
    }
    const sb = admin();
    if (!sb || !mediaStoreEnabled()) {
      cleanup();
      res.status(503).json({ error: 'az átviteli tár nincs konfigurálva' });
      return;
    }

    // a SAJÁT korábbi/lejárt csomagok söprése (lazy TTL + projekt-felülírás)
    const { data: rows } = await sb
      .from('project_transfers')
      .select('project_id, storage_key, created_at')
      .eq('user_id', uid);
    for (const r of rows ?? []) {
      if (r.project_id === projectId || isTransferExpired(r.created_at)) {
        await deleteObject(r.storage_key);
        if (r.project_id !== projectId) {
          await sb
            .from('project_transfers')
            .delete()
            .eq('user_id', uid)
            .eq('project_id', r.project_id);
        }
      }
    }

    const key = `transfer/${uid}/${crypto.randomUUID()}.rp`;
    const publicBase = `${req.protocol}://${req.get('host')}`;
    const url = await uploadMedia(key, f.path, 'application/zip', publicBase);
    const createdAt = new Date().toISOString();
    const { error } = await sb.from('project_transfers').upsert(
      {
        user_id: uid,
        project_id: projectId,
        url,
        storage_key: key,
        size_bytes: Number(f.size || 0),
        created_at: createdAt,
      },
      { onConflict: 'user_id,project_id' }
    );
    cleanup();
    if (error) {
      await deleteObject(key);
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({
      url,
      sizeBytes: Number(f.size || 0),
      expiresAt: new Date(Date.parse(createdAt) + TRANSFER_TTL_MS).toISOString(),
    });
  } catch (e) {
    cleanup();
    res.status(500).json({ error: e?.message || 'transfer hiba' });
  }
});

// 🗑️ csomag törlése (letöltés után / kézzel)
router.delete('/transfer/:projectId', requireAuth, async (req, res) => {
  try {
    const uid = callerId(req);
    const projectId = sanitizeProjectId(req.params.projectId);
    const sb = admin();
    if (!uid || !projectId || !sb) {
      res.status(400).json({ error: 'hibás kérés' });
      return;
    }
    const { data } = await sb
      .from('project_transfers')
      .select('storage_key')
      .eq('user_id', uid)
      .eq('project_id', projectId)
      .maybeSingle();
    if (data?.storage_key) {
      await deleteObject(data.storage_key);
    }
    await sb.from('project_transfers').delete().eq('user_id', uid).eq('project_id', projectId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'transfer hiba' });
  }
});

module.exports = router;
