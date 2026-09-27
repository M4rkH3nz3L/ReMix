/**
 * 📋 Felhő-render SOR (schedules) — a kliens-olvasó a worker `/render/queue`
 * végpontjához. A HOSSZÚ (> CLOUD_RENDER_MIN_SEC) videók a szerver-oldali
 * BullMQ-sorba kerülnek; több render-worker dolgozza fel őket párhuzamosan.
 * Ez a modul csak OLVAS: megmutatja, ki mit renderel, hányan vannak a hívó
 * előtt, és kb. mennyi idő múlva kész — a kész/hibás állapotról a worker külön
 * push/realtime értesítést küld (lásd server/notify.js + notificationStore).
 */
import { cloudBaseUrl } from '@/lib/backend';
import { fetchRead, readJson } from '@/lib/netRetry';
import { useAuth } from '@/store/authStore';
import { workerAuthHeaders } from '@/lib/workerAuth';

export type RenderJobState = 'active' | 'waiting' | 'completed' | 'failed';

/** A futó job épp mit csinál — a beszédes „éppen …" szöveghez. */
export type RenderPhase = 'download' | 'render' | 'upload';

export interface RenderJob {
  id: string;
  state: RenderJobState;
  /** 0–100 (a futó jobnál a mért ffmpeg-haladás) */
  progress: number;
  projectName: string | null;
  /** csak a saját jobnál kitöltve (deep-link) */
  projectId: string | null;
  /** a hívó saját jobja-e */
  mine: boolean;
  /** 1-alapú hely a valós feldolgozási sorban (csak active/waiting) */
  position: number | null;
  /** becsült hátralévő idő a KÉSZ állapotig, mp (csak active/waiting) */
  etaSec: number | null;
  /** becsült idő az INDULÁSIG, mp (waiting: >0, active: 0) */
  startInSec: number | null;
  /** a forrás-videó hossza mp-ben */
  durationSec: number;
  /** melyik fázisban van a futó job (csak active) */
  phaseKey?: RenderPhase | null;
  enqueuedAt: number | null;
  finishedAt: number | null;
  failedReason: string | null;
}

/** Egy worker által ÉPP feldolgozott feladat. */
export interface WorkerActiveJob {
  jobId: string;
  projectName: string | null;
  phaseKey: RenderPhase;
  progress: number;
  mine: boolean;
}

/** Egy render-worker élő állapota a flotta-nézethez. */
export interface RenderWorker {
  id: string;
  /** rövid, ember-olvasható azonosító (pl. PID) a névhez */
  shortId: string | null;
  /** ionicon-név (a szerver adja, a szerep szerint) */
  icon: string;
  /** a worker szerepe — a kliens ebből fordítja a nevet + leírást */
  roleKey: string;
  /** ennyi feladatot bír el párhuzamosan */
  concurrency: number;
  status: 'idle' | 'busy' | 'offline';
  startedAt: number | null;
  activeJobs: WorkerActiveJob[];
}

export interface RenderQueue {
  /** be van-e kapcsolva a felhő-sor (Redis+S3); ha nem, minden render helyben megy */
  enabled: boolean;
  /** ennyi render-worker-szál dolgozik párhuzamosan */
  concurrency: number;
  jobs: RenderJob[];
  /** az élő render-workerek (flotta) */
  workers: RenderWorker[];
  /** hányan vannak a hívó legközelebbi jobja ELŐTT (null, ha nincs sorban lévő jobja) */
  mineAhead: number | null;
  /** a hívó legközelebbi jobjának becsült elkészülése, mp (null, ha nincs) */
  mineEtaSec: number | null;
}

/** A felhő-render sor pillanatképe. Hiba/elérhetetlen worker → `enabled:false`. */
export async function fetchRenderQueue(signal?: AbortSignal): Promise<RenderQueue> {
  const base = cloudBaseUrl();
  const uid = useAuth.getState().user?.id;
  const url = `${base}/render/queue${uid ? `?userId=${encodeURIComponent(uid)}` : ''}`;
  const res = await fetchRead(url, {
    timeoutMs: 6000,
    signal,
    headers: await workerAuthHeaders(),
  });
  const body = await readJson<Partial<RenderQueue>>(res, 'A render-sor nem elérhető.');
  return {
    enabled: Boolean(body.enabled),
    concurrency: body.concurrency ?? 0,
    jobs: Array.isArray(body.jobs) ? body.jobs : [],
    workers: Array.isArray(body.workers) ? body.workers : [],
    mineAhead: typeof body.mineAhead === 'number' ? body.mineAhead : null,
    mineEtaSec: typeof body.mineEtaSec === 'number' ? body.mineEtaSec : null,
  };
}
