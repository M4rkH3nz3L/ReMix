/**
 * 📳 Központi haptika. Eddig ~6 komponens hívta közvetlenül az `expo-haptics`-ot
 * eltérő stílusokkal — itt EGY szemantikus réteg van, hogy a tapintható
 * visszajelzés az egész appban egységes és SZÁNDÉKOS legyen.
 *
 * SZABÁLY: haptika CSAK fontos állapotváltozáskor (snap, kijelölés, törlés,
 * siker/hiba) — SOSEM folyamatosan (görgetés, drag közben pixelenként). Minden
 * hívás best-effort: hiba esetén némán elnyeljük (a haptika sosem törhet meg
 * egy flow-t, és emulátoron/weben egyszerűen nincs).
 */
import * as Haptics from 'expo-haptics';

const swallow = () => {};

export const haptics = {
  /** kijelölés-váltás (klip, tab, opció) — a leggyakoribb, legfinomabb */
  selection: () => Haptics.selectionAsync().catch(swallow),
  /** mágneses illesztés / rácshoz pattanás — könnyű koppintás */
  snap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(swallow),
  /** megerősített akció (gomb, apply) — közepes */
  impact: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(swallow),
  /** határ elérése (idővonal vége, min/max zoom) — kemény, rövid */
  edge: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(swallow),
  /** destruktív művelet (törlés) — figyelmeztető minta */
  delete: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(swallow),
  /** sikeres művelet (export kész, mentés) */
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(swallow),
  /** hiba */
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(swallow),
} as const;
