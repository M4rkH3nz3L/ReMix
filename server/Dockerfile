# 🎬 ReMix render-worker — PRODUCTION image (VIDEO-STUDIO-PROD #2 / 01 §2.2)
#
# A felhő-render queue-worker: a BullMQ „render" sorából húz, az S3/R2-inputokat
# letölti, renderel (ffmpeg), a kész MP4-et S3/R2-be tölti. A render ALATT a
# particles / animált-szöveg / forma-rétegek headless Chromiumot használnak
# (playwright-core → a CHROMIUM_PATH-on). ONNX (arc/mélység) a prebuilt
# onnxruntime-node-ból. WHISPER NEM kell a workerhez (az a /captions API-é).
#
# Build (context = ez a `server/` mappa):
#   docker build -t remix-render server/
# Futtatás — WORKER (alap):
#   docker run --rm --env-file server/.env --cap-add=SYS_ADMIN remix-render
# Futtatás — API (ugyanaz a kép, felülírt paranccsal):
#   docker run --rm --env-file server/.env -p 8787:8787 remix-render node index.js
#
# ⚠️ Chromium-sandbox: a böngésző-launch NEM ad `--no-sandbox`-ot, ezért a
#    konténer kapjon `--cap-add=SYS_ADMIN`-t (a sandbox így inicializálódik), vagy
#    a deploy `--security-opt seccomp=unconfined`-et. Enélkül a particles/animált-
#    szöveg rétegek csendben kimaradnak (a render ettől nem áll le).

FROM node:20-bookworm-slim

# --- rendszer-függőségek (pinned apt) ---
#  ffmpeg  → a render-motor
#  chromium→ a playwright-core headless böngészője (CHROMIUM_PATH-on át)
#  fonts   → a text-render/animált-szöveg: emoji + latin fallback (különben tofu)
#  tini    → rendes PID1: a SIGTERM eljut a workerhez (graceful queue-leállás)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      chromium \
      fonts-liberation fonts-noto-color-emoji fonts-dejavu-core \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app/server

# 1) függőség-réteg ELŐBB (csak a lockfile) → a kódváltozás nem invalidálja az npm ci-t
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) a worker forrása (a .dockerignore kiszűri a node_modules/.env/teszteket/dev-szkriptet)
COPY . ./

# 🐞 a hibajelentések mappája (server/bugs/): a nem-root `node` user írhatja, és a
# compose `bugs-data` kötete ide csatol — a named volume az image-ből örökli a
# tulajdonost, így a deploy-ok közt is megmarad és írható marad
RUN mkdir -p /app/server/bugs && chown node:node /app/server/bugs

# nem-root futtatás (a node image beépített `node` usere)
USER node

# A render-worker nem szolgál ki HTTP-t (health = a BullMQ-heartbeat a Redisben);
# API-ként futtatva a :8787/health az élő-jelzés.
EXPOSE 8787

ENTRYPOINT ["tini", "--"]
CMD ["node", "render-worker.js"]
