/**
 * 🗄️ A tárhely-kártya (src/components/profile/StorageCard.tsx) tiszta, expo-mentes magja:
 * a manuális források mezői, a kvóta-arány, a bővítés havi ára, az aktív cél és a
 * fájl-ikonok. A kártyából kiemelve (REFACTOR) — a viselkedés változatlan.
 */
import { addonDef } from '@/lib/subscriptionPlan';

/** A manuális (nem-OAuth) források mezői — a config a workeren tárolódik. */
export const MANUAL_FIELDS: Record<'webdav' | 's3', { key: string; label: string; secret?: boolean }[]> = {
  webdav: [
    { key: 'baseUrl', label: 'https://nas.otthon:5005' },
    { key: 'path', label: '/videok' },
    { key: 'username', label: 'user' },
    { key: 'password', label: '••••••', secret: true },
  ],
  s3: [
    { key: 'bucket', label: 'media' },
    { key: 'prefix', label: 'nyersanyag/' },
    { key: 'region', label: 'auto' },
    { key: 'endpoint', label: 'https://…r2.cloudflarestorage.com' },
    { key: 'accessKeyId', label: 'ACCESS_KEY' },
    { key: 'secretAccessKey', label: 'SECRET_KEY', secret: true },
  ],
};

/** a +10 GB-os blokkok havi ára (cent-Coin); ismeretlen add-onnál 0 */
export function boostMonthlyCost(blocks: number): number {
  return blocks * (addonDef('storage_10gb')?.priceCents ?? 0);
}

/** a felhasznált arány [0, 1]-ben; nincs adat / 0 kvóta → 0 */
export function usageFraction(usage: { usedBytes: number; quotaBytes: number } | null): number {
  return usage && usage.quotaBytes > 0 ? Math.min(1, usage.usedBytes / usage.quotaBytes) : 0;
}

/** az aktív cél: a kijelölt provider, vagy null (= ReMix-tárhely az alap) */
export function defaultProviderId(providers: { id: string; isDefault: boolean }[]): string | null {
  return providers.find((p) => p.isDefault)?.id ?? null;
}

/** a fájl-lista sorának ikonja a fajta szerint */
export function fileKindEmoji(kind: string): string {
  return kind === 'video' ? '🎬' : kind === 'audio' ? '🎵' : kind === 'model' ? '🧊' : '🖼️';
}
