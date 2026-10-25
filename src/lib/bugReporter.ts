import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';

import { cloudBaseUrl } from '@/lib/backend';
import {
  buildBugPayload,
  chunkBatches,
  deliveryOutcome,
  emptyThrottle,
  enqueueBug,
  makeQid,
  nextBackoffMs,
  normalizeError,
  parseBugQueue,
  parseRetryAfterMs,
  pushBreadcrumb,
  throttleDecision,
  throttleKey,
  type BugKind,
} from '@/lib/bugReport';
import { workerAuthHeaders } from '@/lib/workerAuth';

/**
 * 🐞 Hibajelentő kliens: a futásidejű hibák a workerre (`POST /bugs`) mennek,
 * ahol a `server/bugs/` mappába kerülnek — HIBÁNKÉNT EGY fájlba, javításhoz.
 *
 * Forrásai: globális JS-hibakezelő (fatális is), kezeletlen promise-elutasítás,
 * React ErrorBoundary, és a `reportBug(...)` kézi hívása a kezelt, de fontos
 * hibákra (pl. render-bukás). Minden jelentéshez: platform/OS/eszköz/app-verzió,
 * az aktuális route, a nyitott projekt id-ja, a hiba előtti utolsó lépések
 * (breadcrumb) és a legutóbbi szerkesztő-parancsok TÍPUSAI (tartalom nélkül).
 *
 * KÉZBESÍTÉSI GARANCIA (legalább-egyszer, a szerver szűri a duplikátumot):
 *  - minden jelentés egyedi `qid`-et kap; a szerver az újraküldöttet eldobja,
 *  - az offline-sor MINDEN olvasás-írása egy soros záron megy (az egyidejű
 *    jelentés és ürítés nem írja felül egymást — nincs elveszett jelentés),
 *  - az ürítés egyszerre csak egyszer fut, és csak a SIKERESEN kézbesítetteket
 *    veszi ki a sorból (közben érkező új elem megmarad),
 *  - fatális hibánál az eredeti kezelő (ami leállíthatja az appot) csak a
 *    lemezre írás UTÁN fut (max 1,5 mp várakozással).
 *
 * SZERVER-KÍMÉLÉS (egyetlen kódút: sor → KÖTEGELT ürítés):
 *  - ugyanaz a hiba eszkalálódó ablakkal megy újra (1 → 5 → 15 → 60 perc),
 *    az elnyelt ismétlések száma (`repeat`) a következővel — pontos számláló,
 *  - a sor kötegekben ürül (max 20 jelentés / ~200 KB kérésenként),
 *  - sikertelen kézbesítés után exponenciális visszalépés jitterrel (30 mp →
 *    max 30 perc); a szerver `Retry-After`-jét tiszteli; közben az új jelentés
 *    csak a sorba kerül — a bajban lévő szervert nem terheljük tovább.
 * Sosem dob; `EXPO_PUBLIC_BUG_REPORTS=0` kikapcsolja.
 */

const QUEUE_KEY = 'remix.bugQueue.v1';
const FATAL_PERSIST_TIMEOUT_MS = 1500;

function reportsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BUG_REPORTS !== '0';
}

let throttle = emptyThrottle();
let qidSeq = 0;
let breadcrumbs: string[] = [];
let currentRoute = '';

/** a hiba előtti lépések nyoma (navigáció, fontos műveletek) */
export function addBreadcrumb(text: string): void {
  breadcrumbs = pushBreadcrumb(breadcrumbs, text, new Date().toISOString());
}

/** az aktuális képernyő (a gyökér-layout hívja útvonal-váltáskor) */
export function setBugRoute(route: string): void {
  if (route && route !== currentRoute) {
    currentRoute = route;
    addBreadcrumb(`→ ${route}`);
  }
}

// ── offline-sor: SOROS zár minden olvasás-írásra ────────────────────────────

let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.catch(() => undefined);
  return run;
}

async function readQueue(): Promise<Record<string, unknown>[]> {
  try {
    return parseBugQueue(await AsyncStorage.getItem(QUEUE_KEY));
  } catch {
    return [];
  }
}

async function writeQueue(queue: Record<string, unknown>[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // a tároló hibája nem okozhat újabb hibát
  }
}

function enqueue(payload: Record<string, unknown>): Promise<void> {
  return withQueueLock(async () => {
    await writeQueue(enqueueBug(await readQueue(), payload));
  });
}

// ── kézbesítés: kötegelt POST + visszalépés ──────────────────────────────────

/** visszalépés-állapot: eddig a pillanatig nincs hálózati kísérlet */
let suspendedUntil = 0;
let consecutiveFailures = 0;

function isSuspended(nowMs: number): boolean {
  return nowMs < suspendedUntil;
}

/** a visszalépés végén EGY újrapróba (különben új hiba/előtérbe-lépés nélkül a sor ragadna) */
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function onDeliveryFailure(retryAfterMs: number): void {
  consecutiveFailures += 1;
  const wait = Math.max(nextBackoffMs(consecutiveFailures, Math.random()), retryAfterMs);
  suspendedUntil = Date.now() + wait;
  if (retryTimer) {
    clearTimeout(retryTimer);
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runFlush();
  }, wait + 50);
}

function onDeliverySuccess(): void {
  consecutiveFailures = 0;
  suspendedUntil = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** egy köteg kézbesítése (`{ items }`) → 'done' | 'retry' (+ a szerver Retry-After-je) */
async function postBatch(
  items: Record<string, unknown>[],
): Promise<{ outcome: 'done' | 'retry'; retryAfterMs: number }> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await workerAuthHeaders()) },
      body: JSON.stringify({ items }),
    });
    return {
      outcome: deliveryOutcome(res.status),
      retryAfterMs: parseRetryAfterMs(res.headers?.get?.('Retry-After') ?? null, Date.now()),
    };
  } catch {
    return { outcome: deliveryOutcome(null), retryAfterMs: 0 };
  }
}

/** sor-elem azonosító: a qid, vagy (régi, qid nélküli elemnél) a tartalom */
function itemKey(item: Record<string, unknown>): string {
  return typeof item.qid === 'string' ? item.qid : JSON.stringify(item);
}

let flushing: Promise<Set<string>> | null = null;
let flushAgain = false;

/**
 * Az offline-sor KÖTEGELT elküldése (indításkor, előtérbe lépéskor, minden új
 * jelentés után). Egyszerre egy fut; ha futás közben újra kérik, a végén még egy
 * kör jön. Csak a sikeresen (vagy véglegesen) lezárt elemek kerülnek ki a sorból.
 * Visszalépés alatt nem próbálkozik. Az eredmény: a kézbesített elemek kulcsai.
 */
function runFlush(): Promise<Set<string>> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  // ⚠️ a futás és a jelző SZÉTVÁLASZTVA: ha a futás szinkronban véget ér (pl.
  // visszalépés miatt azonnal kilép), egy belső `finally { flushing = null }`
  // még a hozzárendelés ELŐTT futna le → a jelző örökre bent ragadna, és a sor
  // soha többé nem ürülne. A `.finally` callback mindig a hozzárendelés UTÁN fut.
  const run = doFlush();
  flushing = run;
  void run.finally(() => {
    if (flushing === run) {
      flushing = null;
    }
  });
  return run;
}

async function doFlush(): Promise<Set<string>> {
  const delivered = new Set<string>();
  try {
    do {
      flushAgain = false;
      if (isSuspended(Date.now())) {
        break;
      }
      const snapshot = await withQueueLock(readQueue);
      if (snapshot.length === 0) {
        break;
      }
      const finished = new Set<string>();
      let failed = false;
      for (const batch of chunkBatches(snapshot)) {
        const { outcome, retryAfterMs } = await postBatch(batch);
        if (outcome === 'done') {
          for (const item of batch) {
            finished.add(itemKey(item));
          }
          onDeliverySuccess();
        } else {
          onDeliveryFailure(retryAfterMs);
          failed = true;
          break; // a többit se most — a szerver/hálózat bajban van
        }
      }
      if (finished.size > 0) {
        await withQueueLock(async () => {
          const current = await readQueue();
          await writeQueue(current.filter((x) => !finished.has(itemKey(x))));
        });
        for (const k of finished) {
          delivered.add(k);
        }
      }
      if (failed) {
        break;
      }
    } while (flushAgain);
  } catch {
    // best-effort
  }
  return delivered;
}

export async function flushBugQueue(): Promise<void> {
  await runFlush();
}

// ── kontextus-szolgáltatók (a gyökér-layout regisztrálja) ───────────────────
// Szándékosan NEM importáljuk a store-okat: így nincs import-kör (a store-ok
// gráfja a render-utat is behúzza), és a modul önmagában tesztelhető.

export interface BugEditorContext {
  projectId: string;
  /** az utolsó szerkesztő-parancsok TÍPUSAI (`actor:TYPE`) — tartalom nélkül */
  recent: string[];
}

let editorProvider: (() => BugEditorContext) | null = null;
let signedInFlag = false;

/** a nyitott projekt kontextusának forrása (null = leiratkozás) */
export function setBugEditorContextProvider(fn: (() => BugEditorContext) | null): void {
  editorProvider = fn;
}

/** be van-e jelentkezve a user (a gyökér-layout frissíti) */
export function setBugSignedIn(value: boolean): void {
  signedInFlag = value;
}

function editorContext(): BugEditorContext {
  try {
    const ctx = editorProvider?.();
    return {
      projectId: typeof ctx?.projectId === 'string' ? ctx.projectId : '',
      recent: Array.isArray(ctx?.recent) ? ctx.recent.slice(-8) : [],
    };
  } catch {
    return { projectId: '', recent: [] };
  }
}

export interface BugContext {
  kind?: BugKind;
  componentStack?: string;
  /** rövid, PII-mentes kulcs-érték kontextus (pl. { where: 'renderLocal' }) */
  extra?: Record<string, unknown>;
  /** fatális hibánál: a hívó csak a lemezre írásig vár, a küldés háttérben megy */
  persistOnly?: boolean;
}

export type BugReportResult = 'sent' | 'queued' | 'throttled' | 'disabled' | 'failed';

/**
 * Hiba jelentése a szerverre. Sosem dob. Throttle-olt (eszkalálódó ablak — az
 * elnyelt ismétlések száma a következő jelentéssel megy); visszalépés alatt csak
 * a sorba kerül, és a következő sikeres ürítéssel megy ki.
 */
export async function reportBug(error: unknown, ctx: BugContext = {}): Promise<BugReportResult> {
  if (!reportsEnabled()) {
    return 'disabled';
  }
  try {
    const err = normalizeError(error);
    const decision = throttleDecision(throttle, throttleKey(err), Date.now());
    throttle = decision.next;
    if (!decision.send) {
      return 'throttled';
    }
    const editor = editorContext();
    const payload = buildBugPayload({
      qid: makeQid(Date.now(), Math.random(), ++qidSeq),
      kind: ctx.kind ?? 'handled',
      error: err,
      repeat: decision.repeat,
      componentStack: ctx.componentStack,
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? ''),
      appVersion: Constants.expoConfig?.version ?? '',
      model: Device.modelName ?? '',
      route: currentRoute,
      projectId: editor.projectId,
      breadcrumbs: [
        ...breadcrumbs,
        ...(editor.recent.length > 0 ? [`parancsok: ${editor.recent.join(', ')}`] : []),
      ],
      extra: { ...(ctx.extra ?? {}), signedIn: signedInFlag },
    });
    // EGYETLEN kódút: előbb a tartós sorba, onnan kötegelt kézbesítés — így a
    // menet közbeni leállás sem veszít, és a sor egy kérésben ürül
    await enqueue(payload);
    if (ctx.persistOnly) {
      void runFlush(); // fatális: a hívó csak a lemezre írásig vár
      return 'queued';
    }
    const delivered = await runFlush();
    return delivered.has(itemKey(payload)) ? 'sent' : 'queued';
  } catch {
    return 'failed';
  }
}

interface ErrorUtilsLike {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

interface HermesLike {
  enablePromiseRejectionTracker?: (opts: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

interface BugGlobals {
  ErrorUtils?: ErrorUtilsLike;
  HermesInternal?: HermesLike;
  /** a Fast Refresh a modult újrafuttathatja — a telepítés jelzője a globálison él */
  __remixBugHandlersInstalled?: boolean;
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A globális hibakezelők telepítése (egyszer, a gyökér-layoutból):
 *  - JS-hiba → jelentés, majd az EREDETI kezelő fut tovább (dev-ben LogBox/
 *    redbox, prodban a natív crash-viselkedés marad); fatálisnál az eredeti
 *    kezelő csak a jelentés lemezre írása UTÁN fut (max 1,5 mp)
 *  - kezeletlen promise-elutasítás (Hermes tracker) → jelentés + konzol-figyelmeztetés
 *  - előtérbe lépés / indulás → a korábbi (pl. crash előtti) sor elküldése
 */
export function installGlobalBugHandlers(): void {
  const g = globalThis as BugGlobals;
  if (g.__remixBugHandlersInstalled || !reportsEnabled() || Platform.OS === 'web') {
    return;
  }
  g.__remixBugHandlersInstalled = true;

  const eu = g.ErrorUtils;
  if (eu) {
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      if (isFatal) {
        const persisted = reportBug(error, { kind: 'js-fatal', persistOnly: true });
        void Promise.race([persisted, timeout(FATAL_PERSIST_TIMEOUT_MS)]).finally(() =>
          prev(error, isFatal)
        );
        return;
      }
      void reportBug(error, { kind: 'js-error' });
      prev(error, isFatal);
    });
  }

  const hermes = g.HermesInternal;
  if (hermes && typeof hermes.enablePromiseRejectionTracker === 'function') {
    // metódusként hívva (a natív függvény `this`-e a HermesInternal)
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        void reportBug(rejection, { kind: 'unhandled-rejection' });
        // a láthatóság megmarad (a beépített LogBox-figyelmeztetést ez váltja)
        console.warn('Possible unhandled promise rejection:', rejection);
      },
      onHandled: () => {},
    });
  }

  // előtérbe lépéskor az addig összegyűlt sor kimegy; a háttér/előtér is breadcrumb
  AppState.addEventListener('change', (state) => {
    addBreadcrumb(`app: ${state}`);
    if (state === 'active') {
      void flushBugQueue();
    }
  });

  void flushBugQueue();
}

/** a sorban várakozó (még nem kézbesített) jelentések száma — diagnosztikához */
export async function pendingBugCount(): Promise<number> {
  return (await withQueueLock(readQueue)).length;
}

/** csak teszthez: a modul-állapot visszaállítása */
export function __resetBugReporterForTests(): void {
  throttle = emptyThrottle();
  breadcrumbs = [];
  currentRoute = '';
  editorProvider = null;
  signedInFlag = false;
  flushing = null;
  flushAgain = false;
  suspendedUntil = 0;
  consecutiveFailures = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  queueLock = Promise.resolve();
  (globalThis as BugGlobals).__remixBugHandlersInstalled = false;
}
