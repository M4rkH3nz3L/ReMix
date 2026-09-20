import i18n from 'i18next';
import { Alert } from 'react-native';

import { toAppError } from '@/lib/errors';

/**
 * 🧯 Kétrétegű hiba-alert: a fejlesztői RÉSZLET a logba, a felhasználó egy
 * barátságos, fajta-alapú üzenetet lát (`errors.<kind>`) — sosem nyers
 * „TypeError: …"-t vagy HTTP-státuszt.
 *
 * Imperatív helyekről (`.catch`, Alert-callback) is hívható, mert a GLOBÁLIS
 * i18next singletont használja, nem a React-hookot. A `context` csak a loghoz
 * kell (pl. 'remix', 'export'), a felhasználó nem látja.
 *
 * FONTOS: ne használd ott, ahol a hívott réteg SZÁNDÉKOSAN felhasználó-barát
 * üzenetet dob (pl. domain-validáció) — ott a saját üzenet a jobb.
 */
export function showError(e: unknown, context?: string): void {
  const err = toAppError(e);
  console.warn(context ? `${context}: ${err.detail}` : err.detail);
  Alert.alert(i18n.t('errors.title'), i18n.t(`errors.${err.kind}`));
}
