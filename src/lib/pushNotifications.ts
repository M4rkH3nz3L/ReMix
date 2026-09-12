import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// ⚠️ CSAK TÍPUS-import (a fordító törli) — az expo-notifications futásidejű
// betöltése lentebb, VÉDETTEN történik. Lásd a modul-leírást.
import type * as NotificationsModule from 'expo-notifications';

import { saveCurrentDevicePushToken } from '@/lib/deviceInfo';

/**
 * 📲 Push / helyi értesítések rétege (expo-notifications).
 *
 * ⚠️ EXPO GO + ANDROID: az `expo-notifications` SDK 53 óta **importáláskor dob**
 * ott (a `DevicePushTokenAutoRegistration` mellékhatás push-token listenert
 * regisztrál, a `warnOfExpoGoPushUsage` pedig Androidon `throw`-ol) — egy statikus
 * import az egész appot ledöntötte. Ezért a modult LUSTÁN, `require`-rel töltjük,
 * és Expo Go/Android alatt egyáltalán nem nyúlunk hozzá: ilyenkor minden hívás
 * no-op, az app fut, az in-app értesítés-csengő (Supabase Realtime) változatlanul
 * működik. Rendszer-értesítéshez ott dev build kell.
 *
 * Két út egy modellre (`route` = deep-link cél):
 *   • REALTIME → HELYI notification — amíg fut az app, a Realtime kézbesíti az
 *     új sort, mi pedig rendszer-értesítésként megjelenítjük (`presentLocal`).
 *   • REMOTE push — háttérben is szól; ehhez Expo push-token (fizikai eszköz +
 *     EAS `projectId` + dev/prod build), token a `user_devices.push_token`-ba,
 *     a küldést a worker `POST /notify` intézi.
 *
 * A koppintás mindkét úton a `data.route`-ra navigál — a navigációt a hívó
 * (`_layout`) végzi, ez a modul csak a `route`-ot adja vissza.
 */

/** Expo Go + Android: az expo-notifications betöltése is hibát dob → kihagyjuk. */
const BLOCKED = Platform.OS === 'android' && isRunningInExpoGo();

/** Elérhető-e egyáltalán a rendszer-értesítés ezen a futtatókörnyezeten. */
export function notificationsAvailable(): boolean {
  return Platform.OS !== 'web' && !BLOCKED;
}

let moduleRef: typeof NotificationsModule | null = null;
let triedRequire = false;

/** Az expo-notifications modul, vagy null (web / Expo Go+Android / hiba). */
function notif(): typeof NotificationsModule | null {
  if (!notificationsAvailable()) {
    return null;
  }
  if (moduleRef || triedRequire) {
    return moduleRef;
  }
  triedRequire = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    moduleRef = require('expo-notifications') as typeof NotificationsModule;
    // előtérben is legyen banner + listába kerüljön (a régi shouldShowAlert helyett)
    moduleRef.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    moduleRef = null;
  }
  return moduleRef;
}

/**
 * Az Android értesítés-csatorna azonosítója. MINDEN Android-értesítést ezen kell
 * kiküldeni (`trigger.channelId`) — csatorna nélkül a rendszer a „Miscellaneous"
 * fallback csatornára teszi DEFAULT fontossággal, ami NEM ad heads-up bannert.
 */
const ANDROID_CHANNEL_ID = 'default';

/** a márka-akcentus (a notification-ikon tintje + LED-szín) */
const ACCENT = '#7c5cff';

let channelReady: Promise<void> | null = null;

/**
 * Android-csatorna (a bannerhez/hanghoz kell) — iOS-en no-op. Idempotens és
 * cache-elt, mert a push-regisztráció ÉS minden helyi megjelenítés is hívja
 * (a csatornának léteznie kell az első értesítés előtt, és a push-token
 * lekérése előtt is — lásd Expo-doksi).
 */
export async function ensureAndroidChannel(): Promise<void> {
  const N = notif();
  if (!N || Platform.OS !== 'android') {
    return;
  }
  if (!channelReady) {
    channelReady = N.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Remix',
      importance: N.AndroidImportance.HIGH,
      lightColor: ACCENT,
      enableVibrate: true,
      showBadge: true,
    }).then(() => undefined);
  }
  await channelReady;
}

/** Az EAS projectId (a remote push-tokenhez kell); dev/Expo Go-ban általában nincs. */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export interface PushRegistration {
  granted: boolean;
  /** csak fizikai eszköz + projectId + megadott engedély esetén van remote token */
  token: string | null;
}

/**
 * Engedélykérés + (ha lehet) Expo push-token beszerzése és mentése.
 * Web-en / Expo Go+Androidon no-op. Local notification az engedély megléte esetén
 * már működik; a remote token opcionális (projectId + fizikai eszköz kell hozzá).
 */
export async function registerForPush(userId: string | null): Promise<PushRegistration> {
  const N = notif();
  if (!N) {
    return { granted: false, token: null };
  }
  try {
    await ensureAndroidChannel();

    const existing = await N.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await N.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      return { granted: false, token: null };
    }

    // Remote token: csak fizikai eszközön + ismert projectId-vel értelmes.
    const projectId = easProjectId();
    if (!Device.isDevice || !projectId) {
      return { granted: true, token: null };
    }
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    if (token && userId) {
      await saveCurrentDevicePushToken(userId, token);
    }
    return { granted: true, token: token ?? null };
  } catch {
    // az engedély/token hibája ne dőljön az appra — a realtime csengő megy nélküle is
    return { granted: false, token: null };
  }
}

/**
 * Egy értesítés AZONNALI helyi megjelenítése rendszer-notificationként.
 * A realtime-érkezéskor hívjuk, hogy futó app mellett is „push-élmény" legyen.
 */
export async function presentLocal(input: {
  id?: string;
  title: string;
  body?: string;
  route?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const N = notif();
  if (!N) {
    return;
  }
  try {
    // a csatornának LÉTEZNIE kell az értesítés előtt (különben „Miscellaneous")
    await ensureAndroidChannel();
    const android = Platform.OS === 'android';
    await N.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body ?? undefined,
        sound: true,
        data: { route: input.route ?? null, id: input.id ?? null, ...(input.data ?? {}) },
        // Android: heads-up prioritás + márka-tint + rezgés
        ...(android
          ? {
              priority: N.AndroidNotificationPriority.HIGH,
              color: ACCENT,
              vibrate: [0, 250, 250, 250],
            }
          : null),
      },
      // Androidon a csatornát a triggerben kell megadni (ChannelAwareTriggerInput);
      // `null` → fallback csatorna, ami elnyomja a bannert. iOS: null = azonnal.
      trigger: android ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
  } catch {
    // ha a helyi megjelenítés elbukik, a realtime csengő akkor is frissül
  }
}

/** Egy notification-válaszból (koppintás) kinyeri a deep-link `route`-ot. */
function routeFromResponse(
  response: NotificationsModule.NotificationResponse | null
): string | null {
  const data = response?.notification.request.content.data as { route?: unknown } | undefined;
  return typeof data?.route === 'string' && data.route.length > 0 ? data.route : null;
}

/**
 * Feliratkozás a koppintásokra (előtér/háttér). A `route`-ot adja a callbacknek;
 * a navigációt a hívó végzi. `() => void` leiratkozót ad vissza.
 */
export function addNotificationResponseListener(onRoute: (route: string) => void): () => void {
  const N = notif();
  if (!N) {
    return () => {};
  }
  const sub = N.addNotificationResponseReceivedListener((response) => {
    const route = routeFromResponse(response);
    if (route) {
      onRoute(route);
    }
  });
  return () => sub.remove();
}

/**
 * Hideg indítás: ha az appot egy notification koppintása nyitotta meg, annak
 * `route`-ja (vagy null). A `_layout` ezt egyszer feldolgozza induláskor.
 */
export async function getInitialNotificationRoute(): Promise<string | null> {
  const N = notif();
  if (!N) {
    return null;
  }
  try {
    const response = await N.getLastNotificationResponseAsync();
    return routeFromResponse(response);
  } catch {
    return null;
  }
}
