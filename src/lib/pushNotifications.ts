import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { saveCurrentDevicePushToken } from '@/lib/deviceInfo';

/**
 * 📲 Push / helyi értesítések rétege (expo-notifications).
 *
 * Két út egy modellre (`route` = deep-link cél):
 *   • REALTIME → HELYI notification — amíg fut az app, a Supabase Realtime
 *     kézbesíti az új sort, mi pedig rendszer-értesítésként megjelenítjük
 *     (`presentLocal`). Ez DEVEN (Expo Go is) működik, projectId nélkül.
 *   • REMOTE push — háttérben is szól; ehhez Expo push-token (fizikai eszköz +
 *     EAS `projectId` + dev/prod build), token a `user_devices.push_token`-ba,
 *     a küldést a worker `POST /notify` intézi. projectId híján ez kimarad.
 *
 * A koppintás mindkét úton a `data.route`-ra navigál — a navigációt a hívó
 * (`_layout`) végzi, ez a modul csak a `route`-ot adja vissza.
 */

// Előtérben is jelenjen meg banner + listába kerüljön (a régi shouldShowAlert helyett).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android-csatorna (a bannerhez/hanghoz kell) — iOS-en nincs hatása. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Remix',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#0c0d12',
  });
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
 * Web-en no-op. Local notification az engedély megléte esetén már működik;
 * a remote token opcionális (projectId + fizikai eszköz kell hozzá).
 */
export async function registerForPush(userId: string | null): Promise<PushRegistration> {
  if (Platform.OS === 'web') {
    return { granted: false, token: null };
  }
  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
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
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
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
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body ?? undefined,
        sound: true,
        data: { route: input.route ?? null, id: input.id ?? null, ...(input.data ?? {}) },
      },
      trigger: null, // azonnal
    });
  } catch {
    // ha a helyi megjelenítés elbukik, a realtime csengő akkor is frissül
  }
}

/** Egy notification-válaszból (koppintás) kinyeri a deep-link `route`-ot. */
function routeFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { route?: unknown } | undefined;
  return typeof data?.route === 'string' && data.route.length > 0 ? data.route : null;
}

/**
 * Feliratkozás a koppintásokra (előtér/háttér). A `route`-ot adja a callbacknek;
 * a navigációt a hívó végzi. `() => void` leiratkozót ad vissza.
 */
export function addNotificationResponseListener(onRoute: (route: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
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
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return routeFromResponse(response);
  } catch {
    return null;
  }
}
