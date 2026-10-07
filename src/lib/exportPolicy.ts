import { isPaidTier, type Tier } from '@/lib/tiers';

/**
 * 🎬 Export-politika — EGY forrás a szabályra (02-monetization §2.2):
 *
 *  • **Felhő-render** = a MÉRT/díjazott út → az `exports` kvótába számít, és a
 *    kimenet TISZTA (nincs vízjel).
 *  • **On-device (telón)** = INGYEN, NEM mért; a nem-fizető tier kimenetére
 *    ReMix-**vízjel** kerül (a fizetős tiereké tiszta).
 *
 * A kliens (render-orchestrátor) és a worker (enforce) ezt a szabályt követi.
 */
export type ExportTarget = 'local' | 'cloud';

export interface ExportPolicyResult {
  /** a kvótába/díjba számít? CSAK a felhő-render export. */
  metered: boolean;
  /** vízjel a kimenetre? (ingyen on-device, nem-fizető tier) */
  watermark: boolean;
}

export function exportPolicy(tier: Tier, target: ExportTarget): ExportPolicyResult {
  if (target === 'cloud') {
    return { metered: true, watermark: false };
  }
  return { metered: false, watermark: !isPaidTier(tier) };
}
