import { isDiskFullError } from '@/lib/diskSpace';
import { classifyError, errorDetail } from '@/lib/errors';

/**
 * 📋 Mi kerül a hibanaplóba (`server/bugs/`): CSAK a valódi hiba. Minden elkapott hiba továbbra
 * is a `logCaught`-on megy át (az őrteszt ezt követeli), itt dől el, hogy teendő-e:
 *
 * - a kapcsolat hiánya (offline, megszakadt, időtúllépés, a szerver nem érhető el) a környezet
 *   állapota, nem kódhiba — a hívó úgyis újrapróbál vagy üzenetet ad;
 * - a push-jogosultság nélküli build (`aps-environment`, ingyenes Apple-profil) nem kódhiba;
 * - a foglalt hangmunkamenet (OSStatus 561017449 = `!pri`: hívás vagy más app tartja) várt;
 * - a betelt tárhely a felhasználó állapota (érthető üzenetet kap);
 * - törlésnél a „nincs ilyen” = a cél már nincs meg, a törlés ezzel kész.
 *
 * Minden más valódi hiba — a hiányzó tábla/oszlop/függvény (404/400) is: az séma-eltérés.
 */
export type CaughtVerdict = { report: true } | { report: false; reason: string };

const RULES: { reason: string; test: (detail: string, kind: string, where: string) => boolean }[] = [
  { reason: 'nincs kapcsolat', test: (_d, kind) => kind === 'network' },
  { reason: 'push-jogosultság nélküli build', test: (d) => d.includes('aps-environment') },
  { reason: 'a hangmunkamenetet más tartja (hívás)', test: (d) => d.includes('561017449') },
  { reason: 'betelt a készülék tárhelye', test: (d) => isDiskFullError(d) },
  { reason: 'a törlendő már nincs meg', test: (_d, kind, where) => kind === 'notFound' && /(remove|delete)/i.test(where) },
];

export function caughtVerdict(error: unknown, where: string): CaughtVerdict {
  const detail = errorDetail(error).toLowerCase();
  const kind = classifyError(error);
  const rule = RULES.find((r) => r.test(detail, kind, where));
  return rule ? { report: false, reason: rule.reason } : { report: true };
}
