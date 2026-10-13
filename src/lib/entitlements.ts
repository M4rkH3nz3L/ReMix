/**
 * 🎯 ENTITLEMENT-tábla — a [SCOPES.md](../../devs/tasks/SCOPES.md) §5 mátrix EGYETLEN forrása (kliens).
 *
 * Minden fizetős KÉPESSÉG itt nevesített mező → a kliens-gate (paywall/UX) ebből dolgozik, a
 * szerver-enforce a TÜKRÉBŐL ([server/entitlements.js](../../server/entitlements.js)). A kettőt a
 * `contract.test.ts` **bitre** zárolja (nincs drift). A MÉRT kvóták (aiTokens/renderMinutes/…) NEM itt
 * vannak, hanem a [usageMeter](./usageMeter.ts) `TIER_QUOTAS`-ban (külön réteg); ez a tábla a
 * BOOLEAN/enum/limit képesség-gate-eké.
 *
 * Elv: `free` = 100% ESZKÖZÖN (render device, tár device, AI device, vízjel) → a „felhő" a fizetős határ.
 */
import type { Tier } from './tiers';

export interface Entitlements {
  /** render helye */
  renderEngine: 'device' | 'device+cloud' | 'cloud';
  /** max kimeneti felbontás (rövidebb oldal px) */
  renderMaxRes: 720 | 1080 | 2160;
  /** export-vízjel („Made with ReMix") rákerül-e */
  watermark: boolean;
  /** prioritásos felhő-render-sor */
  renderPriority: boolean;
  /** projekt elsődleges helye */
  storageLocation: 'device' | 'device+cloud' | 'cloud';
  /** automatikus felhő-biztonsági-mentés */
  storageCloudBackup: boolean;
  /** több-eszköz-szinkron */
  storageSync: boolean;
  /** felhő-tárhely GB (0 = csak eszközön; -1 = pool/korlátlan) */
  storageQuotaGB: number;
  /** eszközön futó AI (auto-felirat/vízió) */
  aiOnDevice: boolean;
  /** felhő-AI (hook/script/trend/B-roll) */
  aiCloud: boolean;
  /** publikálás egyáltalán */
  publishEnabled: boolean;
  /** összekötött fiókok max száma (-1 = korlátlan) */
  publishMaxAccounts: number;
  /** ütemezett publikálás */
  publishSchedule: boolean;
  /** per-platform profil (felirat/hossz) */
  platformProfiles: 'none' | 'one' | 'all';
  /** analitika mélysége */
  analyticsLevel: 'none' | 'basic' | 'full' | 'insights' | 'team';
  /** tartalom-naptár */
  planner: boolean;
  /** creator-memory (tanul a stílusodból) */
  creatorMemory: boolean;
  /** ülések (1 = egyéni; -1 = több-seat/per-seat billing) */
  teamSeats: number;
  /** szerepkörök/jogosultságok */
  rbac: boolean;
  /** brand-kit governance */
  brandGovernance: 'none' | 'single' | 'multi' | 'team-lock';
  /** ügyfél-/fiók-kezelés, bulk */
  clientManagement: boolean;
  /** prioritásos support/SLA */
  supportSla: boolean;
  /** API / white-label export */
  apiWhitelabel: boolean;
  /** videó max hossza (mp) — globális plafon; tier-szinten szigoríthatóbb, feljebb nem */
  maxVideoSec: number;
}

/** A tier → entitlement mátrix (SCOPES.md §5). A szerver-tükör (server/entitlements.js) BITRE azonos. */
export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    renderEngine: 'device', renderMaxRes: 720, watermark: true, renderPriority: false,
    storageLocation: 'device', storageCloudBackup: false, storageSync: false, storageQuotaGB: 0,
    aiOnDevice: true, aiCloud: false,
    publishEnabled: false, publishMaxAccounts: 0, publishSchedule: false, platformProfiles: 'none',
    analyticsLevel: 'none', planner: false, creatorMemory: false,
    teamSeats: 1, rbac: false, brandGovernance: 'none', clientManagement: false, supportSla: false, apiWhitelabel: false,
    maxVideoSec: 600,
  },
  basic: {
    renderEngine: 'device+cloud', renderMaxRes: 1080, watermark: false, renderPriority: false,
    storageLocation: 'device+cloud', storageCloudBackup: true, storageSync: false, storageQuotaGB: 10,
    aiOnDevice: true, aiCloud: false,
    publishEnabled: true, publishMaxAccounts: 1, publishSchedule: true, platformProfiles: 'one',
    analyticsLevel: 'basic', planner: true, creatorMemory: false,
    teamSeats: 1, rbac: false, brandGovernance: 'none', clientManagement: false, supportSla: false, apiWhitelabel: false,
    maxVideoSec: 600,
  },
  pro: {
    renderEngine: 'cloud', renderMaxRes: 2160, watermark: false, renderPriority: false,
    storageLocation: 'cloud', storageCloudBackup: true, storageSync: true, storageQuotaGB: 50,
    aiOnDevice: true, aiCloud: true,
    publishEnabled: true, publishMaxAccounts: 3, publishSchedule: true, platformProfiles: 'all',
    analyticsLevel: 'full', planner: true, creatorMemory: true,
    teamSeats: 1, rbac: false, brandGovernance: 'single', clientManagement: false, supportSla: false, apiWhitelabel: false,
    maxVideoSec: 600,
  },
  ultra: {
    renderEngine: 'cloud', renderMaxRes: 2160, watermark: false, renderPriority: true,
    storageLocation: 'cloud', storageCloudBackup: true, storageSync: true, storageQuotaGB: 200,
    aiOnDevice: true, aiCloud: true,
    publishEnabled: true, publishMaxAccounts: 10, publishSchedule: true, platformProfiles: 'all',
    analyticsLevel: 'insights', planner: true, creatorMemory: true,
    teamSeats: 1, rbac: false, brandGovernance: 'multi', clientManagement: false, supportSla: true, apiWhitelabel: false,
    maxVideoSec: 600,
  },
  business: {
    renderEngine: 'cloud', renderMaxRes: 2160, watermark: false, renderPriority: true,
    storageLocation: 'cloud', storageCloudBackup: true, storageSync: true, storageQuotaGB: -1,
    aiOnDevice: true, aiCloud: true,
    publishEnabled: true, publishMaxAccounts: -1, publishSchedule: true, platformProfiles: 'all',
    analyticsLevel: 'team', planner: true, creatorMemory: true,
    teamSeats: -1, rbac: true, brandGovernance: 'team-lock', clientManagement: true, supportSla: true, apiWhitelabel: true,
    maxVideoSec: 600,
  },
};

/** A tier entitlement-jei (ismeretlen tier → free). */
export function entitlementsFor(tier: Tier): Entitlements {
  return ENTITLEMENTS[tier] ?? ENTITLEMENTS.free;
}

/** Boolean-képesség gate (pl. `can('pro','aiCloud')`). */
export function can(tier: Tier, key: BooleanEntitlement): boolean {
  return entitlementsFor(tier)[key] === true;
}

type BooleanEntitlement = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];
