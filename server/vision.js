// Smart Search vision-réteg (P0-8): jelenet-keyframe-ek címkézése a lokális
// multimodális modellel (Ollama, alap: qwen2.5vl:7b — LOCAL_VISION_MODEL
// env-vel cserélhető), és szemantikus keresés nomic-embed-text embeddingekkel.
// A címkézés drága → tartalom-hash alapú lemez-cache.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const VISION_MODEL = process.env.LOCAL_VISION_MODEL || 'qwen2.5vl:7b';
const EMBED_MODEL = process.env.LOCAL_EMBED_MODEL || 'nomic-embed-text';
const CACHE_DIR = path.join(os.tmpdir(), 'vided-vision-cache');

/**
 * Elérhető-e a vision-modell az Ollamában — rövid cache-sel: a /health minden
 * kliens-elemzés (csend/jelenet/beat…) kapuja, és elfoglalt Ollamánál egy
 * cache-eletlen próba a kliens timeoutját is túllépheti.
 */
let visionProbe = { at: 0, ok: false };
async function visionAvailable() {
  if (Date.now() - visionProbe.at < 30 * 1000) {
    return visionProbe.ok;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json();
    visionProbe = {
      at: Date.now(),
      ok: (body.models ?? []).some((m) => m.name.startsWith(VISION_MODEL.split(':')[0])),
    };
  } catch {
    visionProbe = { at: Date.now(), ok: false };
  }
  return visionProbe.ok;
}

function fileHash(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    const s = fs.createReadStream(file, { start: 0, end: 1024 * 1024 });
    s.on('data', (d) => h.update(d));
    s.on('end', () => {
      const size = fs.statSync(file).size;
      resolve(`${h.digest('hex')}-${size}`);
    });
    s.on('error', reject);
  });
}

function extractFrame(file, t, outFile) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-v', 'error', '-ss', String(t), '-i', file,
       '-frames:v', '1', '-vf', 'scale=448:-2', '-q:v', '5', outFile],
      { timeout: 60 * 1000 },
      (err) => (err ? reject(new Error('képkocka-kinyerés hiba')) : resolve())
    );
  });
}

/** egy képkocka címkézése a vision-modellel — kényszerített JSON-kimenettel */
async function labelImage(imageFile) {
  const image = fs.readFileSync(imageFile).toString('base64');
  // per-kép timeout: torlódó Ollama-sor esetén se lógjon örökre a végpont
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120 * 1000);
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      model: VISION_MODEL,
      stream: false,
      messages: [
        {
          role: 'user',
          content:
            'Írd le röviden MAGYARUL, mi látható a képen, és adj 5-10 magyar ' +
            'címkét (tárgyak, személyek, helyszín, hangulat, tevékenység).',
          images: [image],
        },
      ],
      format: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['description', 'labels'],
      },
      options: { temperature: 0.2 },
    }),
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    throw new Error(`vision hiba (${res.status})`);
  }
  const reply = await res.json();
  const parsed = JSON.parse(reply.message?.content ?? '{}');
  return {
    description: String(parsed.description ?? '').slice(0, 300),
    labels: Array.isArray(parsed.labels)
      ? parsed.labels.slice(0, 12).map((l) => String(l).slice(0, 40))
      : [],
  };
}

/**
 * A megadott forrás-időpontok címkézése — fájlonként+időnként lemez-cache-elve.
 * @returns {Promise<[{t, description, labels}]>}
 */
async function indexFrames(file, times, workDir) {
  if (!(await visionAvailable())) {
    throw new Error(
      `Nincs vision-modell az Ollamában — töltsd le: ollama pull ${VISION_MODEL}`
    );
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const hash = await fileHash(file);
  const out = [];
  for (const t of times) {
    const cacheFile = path.join(CACHE_DIR, `${hash}-${t.toFixed(1)}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        out.push(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
        continue;
      } catch {
        // sérült cache — újracímkézzük
      }
    }
    const frameFile = path.join(workDir, `vf-${t.toFixed(1)}.jpg`);
    await extractFrame(file, t, frameFile);
    const labeled = await labelImage(frameFile);
    const entry = { t, ...labeled };
    fs.writeFileSync(cacheFile, JSON.stringify(entry));
    out.push(entry);
  }
  return out;
}

/** szöveg-embeddingek a nomic-embed-text-tel (batch) */
async function embed(texts) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`embed hiba (${res.status})`);
  }
  const body = await res.json();
  return body.embeddings;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** kereső-pontozás: a lekérdezés hasonlósága a dokumentumokhoz (0-1) */
async function queryScores(query, docs) {
  const vectors = await embed([`search_query: ${query}`, ...docs.map((d) => `search_document: ${d}`)]);
  const q = vectors[0];
  return vectors.slice(1).map((v) => Math.round(cosine(q, v) * 1000) / 1000);
}

module.exports = { indexFrames, queryScores, visionAvailable, VISION_MODEL };
