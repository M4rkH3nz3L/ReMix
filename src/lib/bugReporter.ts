import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { cloudBaseUrl } from '@/lib/backend';
import {
  emptyThrottle,
  enqueueBug,
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
 * Hálózati hiba → offline-sor (AsyncStorage), a következő indításkor elküldve.
 * Sosem dob, nem rekurzál; `EXPO_PUBLIC_BUG_REPORTS=0` kikapcsolja.
 */

const QUEUE_KEY = 'remix.bugQueue.v1';
const ENABLED = process.env.EXPO_PUBLIC_BUG_REPORTS !== '0';

let throttle = emptyThrottle();
let breadcrumbs: string[] = [];
let currentRoute = '';
let installed = false;

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

interface BugContext {
  kind?: BugKind;
  /** fatális hibánál: előbb a tartós sorba, onnan küldés (a folyamat leállhat) */
  persistFirst?: boolean;
  componentStack?: string;
  /** rövid, PII-mentes kulcs-érték kontextus (pl. { where: 'renderLocal' }) */
  extra?: Record<string, unknown>;
}

type BugPayload = Record<string, unknown>;

async function postBug(payload: BugPayload): Promise<boolean> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await workerAuthHeaders()) },
      body: JSON.stringify(payload),
    });
    // 4xx (pl. üres/hibás jelentés) ne kerüljön vissza a sorba — újraküldve is bukna
    return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
  } catch {
    return false;
  }
}

async function enqueue(payload: BugPayload): Promise<void> {
  try {
    const queue = parseBugQueue(await AsyncStorage.getItem(QUEUE_KEY));
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(enqueueBug(queue, payload)));
  } catch {
    // a sor is best-effort
  }
}

/** az offline-sor elküldése (indításkor + minden sikeres küldés után) */
export async function flushBugQueue(): Promise<void> {
  try {
    const queue = parseBugQueue(await AsyncStorage.getItem(QUEUE_KEY));
    if (queue.length === 0) {
      return;
    }
    const remaining: unknown[] = [];
    for (const item of queue) {
      if (!(await postBug(item as BugPayload))) {
        remaining.push(item);
      }
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch {
    // best-effort
  }
}

/** a nyitott projekt + az utolsó parancs-típusok (lusta import: nincs import-kör) */
async function editorContext(): Promise<{ projectId: string; recent: string[] }> {
  try {
    const { useEditorStore } = await import('@/store/editorStore');
    const st = useEditorStore.getState();
    return {
      projectId: st.project?.id ?? '',
      recent: (st.events ?? []).slice(-8).map((e) => `${e.actor}:${e.command.type}`),
    };
  } catch {
    return { projectId: '', recent: [] };
  }
}

async function currentUserIdSafe(): Promise<string | null> {
  try {
    const { useAuth } = await import('@/store/authStore');
    return useAuth.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Hiba jelentése a szerverre. Sosem dob; a hívót nem várakoztatja érdemben
 * (fire-and-forget is használható). Throttle-olt: ugyanaz a hiba percenként egyszer.
 */
export async function reportBug(error: unknown, ctx: BugContext = {}): Promise<void> {
  if (!ENABLED) {
    return;
  }
  try {
    const err = normalizeError(error);
    const decision = throttleDecision(throttle, throttleKey(err), Date.now());
    if (!decision.send) {
      return;
    }
    throttle = decision.next;
    const editor = await editorContext();
    const userId = await currentUserIdSafe();
    const payload: BugPayload = {
      kind: ctx.kind ?? 'handled',
      name: err.name,
      message: err.message,
      stack: err.stack,
      componentStack: ctx.componentStack ?? '',
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
      extra: { ...(ctx.extra ?? {}), ...(userId ? { signedIn: true } : { signedIn: false }) },
    };
    if (ctx.persistFirst) {
      // a sorból megy ki (siker esetén onnan törlődik) — így nincs dupla küldés,
      // és ha a folyamat a küldés előtt leáll, a következő indítás pótolja
      await enqueue(payload);
      await flushBugQueue();
      return;
    }
    if (await postBug(payload)) {
      void flushBugQueue();
    } else {
      await enqueue(payload);
    }
  } catch {
    // a hibajelentő sosem okozhat újabb hibát
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

/**
 * A globális hibakezelők telepítése (egyszer, a gyökér-layoutból):
 *  - JS-hiba (fatális is) → jelentés, majd az EREDETI kezelő fut tovább
 *    (dev-ben a LogBox / redbox, prodban a natív crash-viselkedés marad);
 *    fatálisnál a jelentés előbb a sorba íródik (a folyamat leállhat a küldés előtt)
 *  - kezeletlen promise-elutasítás (Hermes tracker) → jelentés + konzol-figyelmeztetés
 *  - induláskor a korábbi (pl. crash előtti) sor elküldése
 */
export function installGlobalBugHandlers(): void {
  if (installed || !ENABLED || Platform.OS === 'web') {
    return;
  }
  installed = true;

  const g = globalThis as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike };
  const eu = g.ErrorUtils;
  if (eu) {
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      void reportBug(error, { kind: isFatal ? 'js-fatal' : 'js-error', persistFirst: !!isFatal });
      prev(error, isFatal);
    });
  }

  const tracker = g.HermesInternal?.enablePromiseRejectionTracker;
  if (tracker) {
    tracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        void reportBug(rejection, { kind: 'unhandled-rejection' });
        // a láthatóság megmarad (a beépített LogBox-figyelmeztetést ez váltja)
        console.warn('Possible unhandled promise rejection:', rejection);
      },
      onHandled: () => {},
    });
  }

  void flushBugQueue();
}
