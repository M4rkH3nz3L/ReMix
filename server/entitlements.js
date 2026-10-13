// 🎯 ENTITLEMENT-tábla — a SCOPES.md §5 mátrix SZERVER-tükre (függőség-mentes).
// A kliens forrása: src/lib/entitlements.ts. A kettőt a src/lib/contract.test.ts BITRE
// zárolja (nincs drift). A szerver-enforce (render/publish/storage/AI) ebből a hiteles
// (server-authoritative) tierből dolgozik — a kliensben sosem bízunk.
const ENTITLEMENTS = {
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

/** A tier entitlement-jei (ismeretlen → free). */
function entitlementsFor(tier) {
  return ENTITLEMENTS[tier] || ENTITLEMENTS.free;
}

// ── Routing-magok (TECH-TOP §1/§6) — a kliens tükre (src/lib/entitlements.ts) ──
/** Rá kell-e égetni a kötelező free-vízjelet? */
function shouldWatermark(tier) {
  return entitlementsFor(tier).watermark;
}
/** Használhat-e FELHŐ-rendert (worker)? Free = csak eszközön → false. */
function canCloudRender(tier) {
  return entitlementsFor(tier).renderEngine !== 'device';
}
/** Használhat-e FELHŐ-tárat (R2)? Free = csak eszköz-tár → false. */
function canCloudStore(tier) {
  return entitlementsFor(tier).storageLocation !== 'device';
}

module.exports = { ENTITLEMENTS, entitlementsFor, shouldWatermark, canCloudRender, canCloudStore };
