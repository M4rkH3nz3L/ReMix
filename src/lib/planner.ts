import { TASK_STATUSES, type TaskStatus, type WorkspaceTask } from '@/lib/workspace';

/**
 * 🗓️ Creator Planner (E-Planner — MASTER §21) — a tartalom-pipeline és -naptár
 * TISZTA logikája a Workspace `WorkspaceTask` kanbanja fölött (Ideas → Backlog →
 * Production → Editing → Review → Scheduled → Published). Platform-naptár, „ezen
 * a héten mit kell?", „melyik áll félbe?", publikációs terv.
 *
 * Expo-mentes, determinisztikus (`now`-paraméterrel) — teljesen tesztelhető.
 * A `schedules.ts` a render-sor-poll; ez a TARTALOM-tervezés, más réteg.
 */

export interface ContentPlatform {
  id: string;
  label: string;
  /** Ionicons név a UI-hoz */
  icon: string;
}

export const CONTENT_PLATFORMS: ContentPlatform[] = [
  { id: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { id: 'tiktok', label: 'TikTok', icon: 'logo-tiktok' },
  { id: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
  { id: 'spotify', label: 'Spotify', icon: 'musical-notes' },
  { id: 'podcast', label: 'Podcast', icon: 'mic' },
  { id: 'blog', label: 'Blog', icon: 'document-text' },
  { id: 'newsletter', label: 'Newsletter', icon: 'mail' },
];

export function contentPlatform(id: string | undefined): ContentPlatform | undefined {
  return id ? CONTENT_PLATFORMS.find((p) => p.id === id) : undefined;
}

// ── Pipeline (a kanban-státusz sorrend) ──────────────────────────────────────

/** a folyamat sorrendje = a `TASK_STATUSES` (idea → … → published). */
export const PIPELINE: TaskStatus[] = TASK_STATUSES;

/** „aktív" (folyamatban lévő) státuszok — a félbehagyás-detektáláshoz. */
const ACTIVE: TaskStatus[] = ['production', 'editing', 'review'];

export function isActive(status: TaskStatus): boolean {
  return ACTIVE.includes(status);
}
export function isPublished(status: TaskStatus): boolean {
  return status === 'published';
}
export function isScheduled(status: TaskStatus): boolean {
  return status === 'scheduled';
}

/** a következő pipeline-státusz (a published a végállapot → önmaga). */
export function nextStatus(status: TaskStatus): TaskStatus {
  const i = PIPELINE.indexOf(status);
  return i < 0 || i === PIPELINE.length - 1 ? status : PIPELINE[i + 1];
}
export function prevStatus(status: TaskStatus): TaskStatus {
  const i = PIPELINE.indexOf(status);
  return i <= 0 ? status : PIPELINE[i - 1];
}

// ── Naptár + időablakok ──────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dateKey = (iso: string): string => iso.slice(0, 10);

/** csak az ütemezett (scheduledFor-ral bíró) feladatok. */
export function scheduledTasks(tasks: WorkspaceTask[]): WorkspaceTask[] {
  return tasks.filter((t) => !!t.scheduledFor);
}

/**
 * Tartalomnaptár: az ütemezett feladatok NAP szerint csoportosítva (YYYY-MM-DD),
 * naponta időrendben. Opcionális `[from, to)` ISO-ablak.
 */
export function calendarByDate(
  tasks: WorkspaceTask[],
  range?: { from?: string; to?: string }
): Record<string, WorkspaceTask[]> {
  const out: Record<string, WorkspaceTask[]> = {};
  for (const t of scheduledTasks(tasks)) {
    const at = t.scheduledFor!;
    if (range?.from && at < range.from) {
      continue;
    }
    if (range?.to && at >= range.to) {
      continue;
    }
    (out[dateKey(at)] ??= []).push(t);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1));
  }
  return out;
}

/**
 * „Ezen a héten mit kell elkészítenem?" — a `now`-tól `days` napon belül
 * ütemezett, MÉG NEM publikált feladatok, időrendben.
 */
export function weekPlan(tasks: WorkspaceTask[], now: string, days = 7): WorkspaceTask[] {
  const to = new Date(new Date(now).getTime() + days * DAY_MS).toISOString();
  return scheduledTasks(tasks)
    .filter((t) => !isPublished(t.status) && t.scheduledFor! >= now && t.scheduledFor! < to)
    .sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1));
}

/**
 * „Melyik projekt áll félbe?" — aktív (production/editing/review) feladatok,
 * amiket `staleDays` napja nem érintett senki (updatedAt alapján).
 */
export function stalledTasks(tasks: WorkspaceTask[], now: string, staleDays = 7): WorkspaceTask[] {
  const cutoff = new Date(new Date(now).getTime() - staleDays * DAY_MS).toISOString();
  return tasks
    .filter((t) => isActive(t.status) && t.updatedAt < cutoff)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
}

/**
 * „Készíts publikációs tervet" — az ütemezett/publikált feladatok időrendben,
 * platformmal. (A tervezett közzétételek listája.)
 */
export function publishSchedule(tasks: WorkspaceTask[]): WorkspaceTask[] {
  return scheduledTasks(tasks)
    .filter((t) => isScheduled(t.status) || isPublished(t.status))
    .sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1));
}

/** Az adott ablak ütemezett feladatai PLATFORMONKÉNT csoportosítva. */
export function upcomingByPlatform(tasks: WorkspaceTask[], now: string, days = 7): Record<string, WorkspaceTask[]> {
  const out: Record<string, WorkspaceTask[]> = {};
  for (const t of weekPlan(tasks, now, days)) {
    const key = t.platform ?? 'unassigned';
    (out[key] ??= []).push(t);
  }
  return out;
}

// ── Összefoglaló (az AI-nak / a dashboardnak) ────────────────────────────────

export interface PlannerSummary {
  /** státuszonkénti darabszám (a kanban-oszlopok mérete) */
  byStatus: Record<TaskStatus, number>;
  scheduled: number;
  published: number;
  thisWeek: number;
  stalled: number;
}

export function plannerSummary(tasks: WorkspaceTask[], now: string, opts: { days?: number; staleDays?: number } = {}): PlannerSummary {
  const byStatus = Object.fromEntries(PIPELINE.map((s) => [s, 0])) as Record<TaskStatus, number>;
  for (const t of tasks) {
    byStatus[t.status]++;
  }
  return {
    byStatus,
    scheduled: tasks.filter((t) => isScheduled(t.status)).length,
    published: byStatus.published,
    thisWeek: weekPlan(tasks, now, opts.days ?? 7).length,
    stalled: stalledTasks(tasks, now, opts.staleDays ?? 7).length,
  };
}
