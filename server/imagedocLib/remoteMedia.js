const { logCaught } = require('../lib/caught');
// 🎨 Kép-dokumentum — a távoli (https) réteg-média letöltése / helyi feloldása a render előtt.
const fs = require('fs');
const path = require('path');

const MAX_REMOTE_BYTES = 40 * 1024 * 1024;

/**
 * 🌐 I14: a PSD/PDF-importált rétegek https URL-t hordoznak, a render viszont helyi fájlt
 * olvas. A távoli médiát a munkakönyvtárba töltjük (a `fetchUrl` SSRF-védett), a saját
 * média-tár URL-jét közvetlenül a lemezről oldjuk fel (`localPath`). Ami nem érhető el,
 * az marad — a render `onMissing`-gel jelzi.
 */
async function resolveRemoteMedia(doc, workDir, { fetchUrl, localPath }) {
  let seq = 0;
  for (const layer of doc.layers ?? []) {
    const refs = ['uri', 'imageUri', 'lut'].map((key) => [layer, key]);
    if (layer.mask?.image) {
      refs.push([layer.mask, 'image']);
    }
    for (const [holder, key] of refs) {
      const url = holder[key];
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        continue;
      }
      const local = localPath?.(url);
      if (local) {
        holder[key] = local;
        continue;
      }
      try {
        const res = await fetchUrl(url);
        if (!res || !res.ok) {
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_REMOTE_BYTES) {
          continue;
        }
        const ext = path.extname(new URL(url).pathname).slice(0, 8) || '.bin';
        const file = path.join(workDir, `remote${seq}${ext}`);
        seq += 1;
        fs.writeFileSync(file, buf);
        holder[key] = file;
      } catch (caught) {
        logCaught('imagedoc.js:resolveRemoteMedia', caught);
        /* elérhetetlen → a réteg hiányzóként jelentődik */
      }
    }
  }
}

module.exports = { MAX_REMOTE_BYTES, resolveRemoteMedia };
