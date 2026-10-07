/**
 * 🔀 Külső fájl-verziózás — konfliktus-detektáló mag (audit §8.6).
 *
 * A user SAJÁT felhőjén (Drive/Dropbox/WebDAV/S3) fekvő médiát más eszköz vagy
 * maga a user is módosíthatja. Ha csak „letöltjük a frisset" vagy „feltöltjük a
 * miénket", csendben felülírhatunk egy másik változtatást. Ez a mag egy 3-utas
 * összevetéssel (lokális · távoli · közös ŐS) eldönti a SYNC-ÁLLAPOTot, amiből a
 * „Remote changed → Use new / Keep current / Compare" flow a helyes gombokat adja.
 *
 * Tiszta, keretrendszer-független → tesztelhető; az IO (letöltés/feltöltés) + a
 * bázis-hash tárolása a bekötés (mediaSync / storageProviders).
 */

export interface FileVersion {
  /** tartalom-ujjlenyomat (hash/etag); `null`/`undefined` = nem ismert */
  hash?: string | null;
  /** utolsó módosítás ISO-ban (tie-break / megjelenítés) */
  modifiedAt?: string | null;
  /** létezik-e; ha nincs megadva, a hash jelenlétéből következtetünk */
  exists?: boolean;
}

export type SyncState =
  | 'in-sync' // lokális == távoli
  | 'local-only' // csak lokálisan van (új → feltöltendő)
  | 'remote-only' // csak távol van (új → letöltendő)
  | 'local-ahead' // lokális változott, a távoli == ős → biztonságos feltölteni
  | 'remote-ahead' // távoli változott, a lokális == ős → a távoli a frissebb
  | 'conflict' // MINDKETTŐ változott (vagy nincs közös ős) → a user döntsön
  | 'absent'; // egyik helyen sincs

/** A §8.6 flow lehetséges akciói egy állapothoz. */
export type SyncAction = 'none' | 'upload' | 'download' | 'use-remote' | 'keep-local' | 'compare';

function present(v: FileVersion | null | undefined): boolean {
  if (!v) {
    return false;
  }
  return v.exists ?? (v.hash != null && v.hash !== '');
}

/**
 * A lokális és a távoli változat viszonya, opcionális közös ŐS (base) alapján.
 * Base nélkül egy hash-eltérést KONFLIKTUSnak veszünk (nem találgatjuk az irányt
 * modifiedAt-ból → nincs csendes felülírás).
 */
export function syncState(
  local: FileVersion | null | undefined,
  remote: FileVersion | null | undefined,
  base?: FileVersion | null,
): SyncState {
  const l = present(local);
  const r = present(remote);
  if (!l && !r) {
    return 'absent';
  }
  if (l && !r) {
    return 'local-only';
  }
  if (!l && r) {
    return 'remote-only';
  }
  // mindkettő létezik
  const lHash = local?.hash ?? null;
  const rHash = remote?.hash ?? null;
  if (lHash != null && rHash != null && lHash === rHash) {
    return 'in-sync';
  }
  // a tartalom eltér (vagy valamelyik hash ismeretlen) → az irányhoz közös ős kell
  const baseHash = present(base) ? base?.hash ?? null : null;
  if (baseHash == null) {
    return 'conflict';
  }
  const localChanged = lHash !== baseHash;
  const remoteChanged = rHash !== baseHash;
  if (localChanged && remoteChanged) {
    return 'conflict';
  }
  if (localChanged) {
    return 'local-ahead';
  }
  if (remoteChanged) {
    return 'remote-ahead';
  }
  // elvi ellentmondás (egyik sem változott, mégis eltérnek) → biztonságosan konfliktus
  return 'conflict';
}

/** A felhasználónak felkínálható akciók az adott állapotban (az első az ajánlott). */
export function resolutionActions(state: SyncState): SyncAction[] {
  switch (state) {
    case 'in-sync':
    case 'absent':
      return ['none'];
    case 'local-only':
      return ['upload'];
    case 'remote-only':
      return ['download'];
    case 'local-ahead':
      return ['upload', 'keep-local'];
    case 'remote-ahead':
      return ['use-remote', 'keep-local', 'compare'];
    case 'conflict':
      return ['use-remote', 'keep-local', 'compare'];
    default:
      return ['none'];
  }
}

/** Igényel-e a user figyelmét (konfliktus vagy távoli-változás) — badge/prompt-hoz. */
export function needsAttention(state: SyncState): boolean {
  return state === 'conflict' || state === 'remote-ahead';
}

/** Feloldható-e automatikusan, user nélkül (egyértelmű irány). */
export function isAutoResolvable(state: SyncState): boolean {
  return state === 'local-only' || state === 'remote-only' || state === 'local-ahead' || state === 'in-sync';
}

// ── UI: megjelenítés (badge + akció-címke) ──────────────────────────────────

/**
 * Egy Asset DURVA sync-állapota a valós mezőkből (hash nélkül, UI-jelzőhöz): helyi
 * másolat (uri nem http) + felhő-másolat (remoteUrl) jelenlétéből. Hash/base nélkül a
 * divergenciát nem tudjuk — két meglévő változatot `in-sync`-nek (biztonságos default)
 * veszünk; a valódi konfliktus-detektálás a sync-folyam base-hash-ével jön.
 */
export function assetSyncState(asset: { uri?: string; remoteUrl?: string | null }): SyncState {
  const uriIsHttp = !!asset.uri && /^https?:\/\//i.test(asset.uri);
  const local = !!asset.uri && !uriIsHttp;
  // felhő-oldal: a backup-URL VAGY egy stream-uri (http) is távoli forrás
  const remote = !!asset.remoteUrl || uriIsHttp;
  if (local && remote) {
    return 'in-sync';
  }
  if (local) {
    return 'local-only';
  }
  if (remote) {
    return 'remote-only';
  }
  return 'absent';
}

export interface SyncBadge {
  icon: string;
  labelKey: string;
  tone: 'ok' | 'dim' | 'warn';
}

const SYNC_BADGES: Record<SyncState, SyncBadge> = {
  'in-sync': { icon: 'cloud-done-outline', labelKey: 'sync.state.inSync', tone: 'ok' },
  'local-only': { icon: 'cloud-upload-outline', labelKey: 'sync.state.localOnly', tone: 'warn' },
  'remote-only': { icon: 'cloud-download-outline', labelKey: 'sync.state.remoteOnly', tone: 'dim' },
  'local-ahead': { icon: 'cloud-upload-outline', labelKey: 'sync.state.localAhead', tone: 'warn' },
  'remote-ahead': { icon: 'cloud-download-outline', labelKey: 'sync.state.remoteAhead', tone: 'warn' },
  conflict: { icon: 'git-compare-outline', labelKey: 'sync.state.conflict', tone: 'warn' },
  absent: { icon: 'help-outline', labelKey: 'sync.state.absent', tone: 'dim' },
};

/** A sync-állapot UI-jelzője (ikon + i18n-címke + tone). */
export function syncStateBadge(state: SyncState): SyncBadge {
  return SYNC_BADGES[state];
}

/** Egy feloldási akció i18n-címke-kulcsa (a `resolutionActions` gombjaihoz). */
export function syncActionLabelKey(action: SyncAction): string {
  return `sync.action.${action}`;
}
