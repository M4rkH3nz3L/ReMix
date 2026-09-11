/**
 * 🔗 Interaktív hotspot / link URL alaki ellenőrzése.
 *
 * A tényleges megnyithatóságot a lejátszó a `Linking.canOpenURL`-lel is
 * ellenőrzi; ez a gyors, UI-oldali validáció (mező-hiba + a csupasz `https://`
 * kiszűrése), hogy ne mentsünk/nyissunk üres linket.
 */
export function isValidActionUrl(url: string): boolean {
  const u = (url ?? '').trim();
  // http(s):// + valódi host-kezdőkarakter + valami utána (a csupasz "https://" bukik)
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(u);
}
