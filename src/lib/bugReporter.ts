import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';

import { cloudBaseUrl } from '@/lib/backend';
import {
  buildBugPayload,
  deliveryOutcome,
  emptyThrottle,
  enqueueBug,
  makeQid,
  normalizeError,
  parseBugQueue,
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
 * Sosem dob; `EXPO_PUBLIC_BUG_REPORTS=0` kikapcsolja.
 */

const QUEUE_KEY = 'remix.bugQueue.v1';
const FATAL_PERSIST_TIMEOUT_MS = 1500;

function reportsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BUG_REPORTS !== '0';
}

let throttle = emptyThrottle();
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

async function postBug(payload: Record<string, unknown>): Promise<'done' | 'retry'> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await workerAuthHeaders()) },
      body: JSON.stringify(payload),
    });
    return deliveryOutcome(res.status);
  } catch {
    return deliveryOutcome(null);
  }
}

/** sor-elem azonosító: a qid, vagy (régi, qid nélküli elemnél) a tartalom */
function itemKey(item: Record<string, unknown>): string {
  return typeof item.qid === 'string' ? item.qid : JSON.stringify(item);
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/**
 * Az offline-sor elküldése (indításkor, előtérbe lépéskor, sikeres küldés után).
 * Egyszerre egy fut; ha futás közben újra kérik, a végén még egy kör jön.
 * Csak a sikeresen (vagy véglegesen) lezárt elemek kerülnek ki a sorból.
 */
export function flushBugQueue(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        flushAgain = false;
        const snapshot = await withQueueLock(readQueue);
        if (snapshot.length === 0) {
          break;
        }
        const finished = new Set<string>();
        for (const item of snapshot) {
          if ((await postBug(item)) === 'done') {
            finished.add(itemKey(item));
          } else {
            break; // hálózat/szerver gond — a többit se most próbáljuk
          }
        }
        if (finished.size > 0) {
          await withQueueLock(async () => {
            const current = await readQueue();
            await writeQueue(current.filter((x) => !finished.has(itemKey(x))));
          });
        }
        if (finished.size < snapshot.length) {
          break; // maradt sikertelen — majd a következő alkalommal
        }
      } while (flushAgain);
    } catch {
      // best-effort
    } finally {
      flushing = null;
    }
  })();
  return flushing;
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
 * Hiba jelentése a szerverre. Sosem dob. Throttle-olt: ugyanaz a hiba percenként
 * egyszer (az elnyelt ismétlések száma a következő jelentéssel megy).
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
      qid: makeQid(Date.now(), Math.random()),
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
    if (ctx.persistOnly) {
      // a sorból megy ki (siker esetén onnan törlődik) — ha a folyamat a küldés
      // előtt leáll, a következő indítás pótolja
      await enqueue(payload);
      void flushBugQueue();
      return 'queued';
    }
    if ((await postBug(payload)) === 'done') {
      void flushBugQueue();
      return 'sent';
    }
    await enqueue(payload);
    return 'queued';
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
  queueLock = Promise.resolve();
  (globalThis as BugGlobals).__remixBugHandlersInstalled = false;
}
