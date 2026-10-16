import type { ReportReason } from '@/lib/reports';

/**
 * 🛡️ Moderáció — tiszta döntés/rangsor-mag (Socials §04.1/§04.2/§04.3).
 *
 * A séma (reports/appeals/restricted/RBAC) + a kliens-CRUD kész; ez a mag a hiányzó
 * INTELLIGENCIA, tiszta függvényekben: moderációs-sor prioritás+routing+SLA (§04.3),
 * auto-quarantine küszöb ismétlődő-elkövető jellel (§04.2), és az appeal-elbírálás
 * státusz-leképzése (§04.1). Szándékosan expo/supabase-MENTES (csak `ReportReason`
 * TÍPUS-import, ami a buildben törlődik) → önmagában unit-tesztelt; a `Record<ReportReason,…>`
 * táblák compile-time zárolják a kategória-drift ellen. A tényleges DB-trigger/RPC
 * a bekötés — ez a kontraktus. A szigorúság az RBAC/RLS-é; a mag csak RANGSOROL/DÖNT.
 */

/** Súlyosság: illegal > harassment > offensive > spam > other (§04.3). */
export const SEVERITY_WEIGHT: Record<ReportReason, number> = {
  illegal: 100,
  harassment: 60,
  offensive: 30,
  spam: 15,
  other: 10,
};

/** Kategóriánkénti SLA percben (meddig elfogadható nyitva lennie). */
export const SLA_MINUTES: Record<ReportReason, number> = {
  illegal: 60,
  harassment: 240,
  offensive: 720,
  spam: 1440,
  other: 1440,
};

/** Routing: melyik moderátor-csoporthoz tartozik a kategória. */
export const CATEGORY_ROUTE: Record<ReportReason, string> = {
  illegal: 'trust_safety',
  harassment: 'trust_safety',
  offensive: 'general',
  spam: 'spam_team',
  other: 'general',
};

function asReason(reason: string | undefined): ReportReason {
  return reason && reason in SEVERITY_WEIGHT ? (reason as ReportReason) : 'other';
}

export function severityWeight(reason: string | undefined): number {
  return SEVERITY_WEIGHT[asReason(reason)];
}

export function routeCategory(reason: string | undefined): string {
  return CATEGORY_ROUTE[asReason(reason)];
}

export function slaMinutes(reason: string | undefined): number {
  return SLA_MINUTES[asReason(reason)];
}

export type ModItemKind = 'report' | 'appeal' | 'auto_flag';

export interface ModItem {
  kind: ModItemKind;
  reason?: ReportReason | string;
  /** nyitva (létrehozva) mikor, ms epoch */
  createdAtMs: number;
  /** hány EGYEDI bejelentő (a koncentrált bejelentés súlyosbít) */
  uniqueReporters?: number;
  /** az elkövető korábbi strike-jai (removed poszt / megalapozott report) */
  offenderPriorStrikes?: number;
}

const AGE_WEIGHT_PER_MIN = 0.1; // öregedési nyomás percenként
const AGE_CAP = 50; // az öregedés max ennyit adhat (a súlyosság ne boruljon)
const REPORTER_WEIGHT = 5; // minden extra egyedi bejelentő
const OFFENDER_WEIGHT = 8; // minden korábbi strike
const AUTO_FLAG_BOOST = 5; // a gépi flag kis előnyt kap emberi review-ra

export function ageMinutes(item: ModItem, nowMs: number): number {
  return Math.max(0, (nowMs - item.createdAtMs) / 60_000);
}

/**
 * Egy moderációs teendő prioritása (magasabb = sürgősebb). A súlyosság dominál,
 * az öregedés/bejelentő-szám/elkövető-history finomhangol; az öregedés sapkázott,
 * hogy egy régi spam ne előzzön egy friss illegal-t.
 */
export function moderationPriority(item: ModItem, nowMs: number): number {
  const base = severityWeight(item.reason);
  const age = Math.min(AGE_CAP, ageMinutes(item, nowMs) * AGE_WEIGHT_PER_MIN);
  const reporters = Math.max(0, (item.uniqueReporters ?? 1) - 1) * REPORTER_WEIGHT;
  const offender = Math.max(0, item.offenderPriorStrikes ?? 0) * OFFENDER_WEIGHT;
  const kindBoost = item.kind === 'auto_flag' ? AUTO_FLAG_BOOST : 0;
  return base + age + reporters + offender + kindBoost;
}

/** A teljes sor prioritási sorrendben (csökkenő; döntetlennél stabil). */
export function rankModerationQueue<T extends ModItem>(items: readonly T[], nowMs: number): T[] {
  return (items ?? [])
    .map((item, i) => ({ item, i, p: moderationPriority(item, nowMs) }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.item);
}

/** Lejárt-e az SLA (tovább van nyitva, mint a kategória határa). */
export function slaBreached(item: ModItem, nowMs: number): boolean {
  return ageMinutes(item, nowMs) > slaMinutes(item.reason);
}

// ── §04.2 Auto-detektálás ─────────────────────────────────────────────────────

/** Alapértelmezett küszöb: ennyi EGYEDI bejelentő felett auto-quarantine. */
export const DEFAULT_QUARANTINE_THRESHOLD = 3;

export interface QuarantineInput {
  uniqueReporters: number;
  threshold?: number;
}

/**
 * Auto-quarantine döntés: a küszöböt elérő EGYEDI bejelentés a posztot `pending`-be
 * (quarantine) teszi — SOHA nem `removed`-be (emberi review nélkül nincs véglegesítés).
 */
export function autoQuarantineDecision({
  uniqueReporters,
  threshold = DEFAULT_QUARANTINE_THRESHOLD,
}: QuarantineInput): { action: 'none' | 'quarantine'; status: 'ok' | 'pending'; reason: string } {
  if ((uniqueReporters ?? 0) >= threshold) {
    return { action: 'quarantine', status: 'pending', reason: 'report_threshold' };
  }
  return { action: 'none', status: 'ok', reason: 'below_threshold' };
}

export interface OffenderInput {
  /** eltávolított posztjainak száma */
  removedPosts?: number;
  /** megalapozott (resolved) report-ok ellene */
  upheldReports?: number;
  /** a fiók kora napokban (friss fiók gyanúsabb) */
  accountAgeDays?: number;
}

/**
 * Ismétlődő-elkövető pontszám (0+) — a `moderationPriority` offenderPriorStrikes
 * bemenetét táplálhatja. Friss fiók (<7 nap) extra strike-ot kap.
 */
export function repeatOffenderScore(i: OffenderInput = {}): number {
  const removed = Math.max(0, i.removedPosts ?? 0);
  const upheld = Math.max(0, i.upheldReports ?? 0);
  const freshBoost = (i.accountAgeDays ?? Infinity) < 7 ? 2 : 0;
  return removed * 2 + upheld + freshBoost;
}

// ── §04.1 Appeal-elbírálás ────────────────────────────────────────────────────

export type AppealDecision = 'granted' | 'denied';

/**
 * Az appeal-elbírálás hatása: granted → a poszt visszaáll `ok`-ra (újra látszik),
 * denied → `removed` marad. (A tényleges írás a `moderate_post` RPC-é.)
 */
export function appealResolutionEffect(decision: AppealDecision): {
  appealStatus: AppealDecision;
  postModerationStatus: 'ok' | 'removed';
} {
  return decision === 'granted'
    ? { appealStatus: 'granted', postModerationStatus: 'ok' }
    : { appealStatus: 'denied', postModerationStatus: 'removed' };
}
