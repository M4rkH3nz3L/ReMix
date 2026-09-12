/**
 * 📱 Eszközadat-gyűjtő — a `user_devices` táblához.
 *
 * Annyi adatot szedünk össze, amennyit a natív modulok szerver nélkül adnak:
 * modell/gyártó/OS (`expo-device`), képernyő-felbontás + pixelarány
 * (`Dimensions`/`PixelRatio`), nyelv/régió/időzóna (`expo-localization`),
 * app-verzió (`expo-constants`). Semmi engedélyköteles adat (nincs IMEI/helyadat).
 *
 * Az eszköz azonosítója egy TELEPÍTÉSENKÉNT egyszer generált `fingerprint`, amit
 * AsyncStorage-ban perzisztálunk — így ugyanaz az eszköz újranyitáskor a meglévő
 * sorát frissíti (`upsert` a (user_id, fingerprint) kulcson), nem duplikál.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import { Dimensions, PixelRatio, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const INSTALL_ID_KEY = 'remix.installId.v1';

/** RFC-4122-szerű v4 UUID — nem biztonsági célra (telepítés-azonosító), Math.random elég. */
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** A telepítés stabil azonosítója; első hívásra generálja + elmenti. */
export async function getInstallId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (existing) {
      return existing;
    }
  } catch {
    // olvasási hiba → új id (nem kritikus)
  }
  const id = uuidv4();
  try {
    await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  } catch {
    // best-effort perzisztálás
  }
  return id;
}

/** DeviceType enum → rövid szöveg (a DB-ben olvasható értékként tároljuk). */
function deviceTypeLabel(type: Device.DeviceType | null): string {
  switch (type) {
    case Device.DeviceType.PHONE:
      return 'phone';
    case Device.DeviceType.TABLET:
      return 'tablet';
    case Device.DeviceType.DESKTOP:
      return 'desktop';
    case Device.DeviceType.TV:
      return 'tv';
    default:
      return 'unknown';
  }
}

/** A `user_devices` sor a `user_id`/`last_seen` nélkül (azt a hívó teszi rá). */
export interface DeviceRow {
  fingerprint: string;
  platform: string;
  brand: string | null;
  manufacturer: string | null;
  model_name: string | null;
  model_id: string | null;
  design_name: string | null;
  product_name: string | null;
  device_name: string | null;
  device_type: string;
  device_year_class: number | null;
  os_name: string | null;
  os_version: string | null;
  api_level: number | null;
  total_memory: number | null;
  cpu_archs: string[] | null;
  is_physical: boolean;
  screen_width_dp: number;
  screen_height_dp: number;
  screen_width_px: number;
  screen_height_px: number;
  pixel_ratio: number;
  font_scale: number;
  window_width_dp: number;
  window_height_dp: number;
  locale: string | null;
  region: string | null;
  timezone: string | null;
  currency: string | null;
  app_version: string | null;
  raw: Record<string, unknown>;
}

/** Összeszedi az aktuális eszköz adatait (DB-sor alakban). */
export async function collectDeviceInfo(): Promise<DeviceRow> {
  const fingerprint = await getInstallId();
  const deviceType = await Device.getDeviceTypeAsync().catch(() => Device.DeviceType.UNKNOWN);

  const screen = Dimensions.get('screen');
  const win = Dimensions.get('window');
  const pixelRatio = PixelRatio.get();
  const fontScale = PixelRatio.getFontScale();

  const locale = Localization.getLocales()[0];
  const calendar = Localization.getCalendars()[0];

  const base = {
    fingerprint,
    platform: Platform.OS,
    brand: Device.brand ?? null,
    manufacturer: Device.manufacturer ?? null,
    model_name: Device.modelName ?? null,
    model_id: Device.modelId ?? null,
    design_name: Device.designName ?? null,
    product_name: Device.productName ?? null,
    device_name: Device.deviceName ?? null,
    device_type: deviceTypeLabel(deviceType),
    device_year_class: Device.deviceYearClass ?? null,
    os_name: Device.osName ?? null,
    os_version: Device.osVersion ?? null,
    api_level: Device.platformApiLevel ?? null,
    total_memory: Device.totalMemory ?? null,
    cpu_archs: Device.supportedCpuArchitectures ?? null,
    is_physical: Device.isDevice,
    screen_width_dp: Math.round(screen.width),
    screen_height_dp: Math.round(screen.height),
    screen_width_px: Math.round(screen.width * pixelRatio),
    screen_height_px: Math.round(screen.height * pixelRatio),
    pixel_ratio: pixelRatio,
    font_scale: fontScale,
    window_width_dp: Math.round(win.width),
    window_height_dp: Math.round(win.height),
    locale: locale?.languageTag ?? null,
    region: locale?.regionCode ?? null,
    timezone: calendar?.timeZone ?? null,
    currency: locale?.currencyCode ?? null,
    app_version: Constants.expoConfig?.version ?? null,
  };

  // minden nyers érték egyben (ha később új mező kell, itt megvan)
  return { ...base, raw: { ...base, retrievedAtLocal: new Date().toISOString() } };
}

/**
 * A jelenlegi eszköz beírása/frissítése a bejelentkezett userhez.
 * `upsert` a (user_id, fingerprint) kulcson → első nyitáskor beszúr,
 * később csak a `last_seen`-t és a változó mezőket frissíti. Best-effort:
 * hibát elnyel, hogy a be-/regisztráció ne bukjon el az eszközírás miatt.
 */
export async function registerCurrentDevice(userId: string): Promise<void> {
  if (!supabase) {
    return;
  }
  try {
    const info = await collectDeviceInfo();
    await supabase.from('user_devices').upsert(
      { user_id: userId, ...info, last_seen: new Date().toISOString() },
      { onConflict: 'user_id,fingerprint' },
    );
  } catch {
    // best-effort telemetria; a bejelentkezést nem blokkolja
  }
}

/**
 * Az Expo push-token elmentése a jelenlegi eszköz sorára (`user_devices.push_token`).
 * A (user_id, fingerprint) kulcson upsert-el, így ugyanahhoz az eszközhöz köti,
 * amit a `registerCurrentDevice` írt. Best-effort. A workert (POST /notify) ez
 * táplálja a remote-push kézbesítéshez.
 */
export async function saveCurrentDevicePushToken(userId: string, token: string): Promise<void> {
  if (!supabase) {
    return;
  }
  try {
    const fingerprint = await getInstallId();
    await supabase
      .from('user_devices')
      .update({ push_token: token, last_seen: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('fingerprint', fingerprint);
  } catch {
    // best-effort; a push nélkül is megy a realtime + in-app csengő
  }
}
