import { router } from 'expo-router';

/**
 * 🔙 Biztonságos „vissza": ha van hova lépni, visszalép; ha NINCS (a képernyő a
 * navigációs verem gyökere — pl. deep-link vagy értesítésből nyitva, vagy ez az
 * első route app-indításkor), a kezdőképernyőre visz a nyers `router.back()`
 * helyett. A nyers `router.back()` ilyenkor a „The action 'GO_BACK' was not
 * handled by any navigator" dev-figyelmeztetést dobná és nem csinálna semmit.
 */
export function goBackOrHome(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}
