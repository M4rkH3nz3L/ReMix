import { capabilityRequiresPro, type CapabilityId } from '@/lib/capabilities';

/**
 * 🧩 Workflow Template (E-Templates — MASTER §17) — nem preset, hanem LÁNC: egy
 * nevesített pipeline (pl. YouTube Creator: Footage → AI-Select → Transcript →
 * Filler-Removal → Hook → Captions → B-roll → Color → Thumbnail → Export →
 * Publish), amit a creator egy gombbal végigfuttat. A `workflow.ts` a per-projekt
 * NLE-stage-KÖVETŐ; ez a újrahasználható SABLON + futtatás.
 *
 * Minden lépés opcionálisan egy `CapabilityId`-hez kötött → a Pro/felhő-kapu a
 * KATALÓGUSBÓL jön (a DNS: „új képesség = egy sor a capability-katalógusban").
 * Tiszta, expo-mentes, immutábilis, determinisztikus.
 */

export interface WorkflowStep {
  id: string;
  /** gépi lépés-típus (a végrehajtó ez alapján dönt); szabad string, bővíthető */
  kind: string;
  /** i18n-kulcs vagy nyers címke a UI-hoz */
  label: string;
  /** ha a lépés egy katalógus-képességet igényel (Pro/felhő-gate innen) */
  capability?: CapabilityId;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  /** melyik creator-szerephez ajánlott (opcionális) */
  role?: string;
  steps: WorkflowStep[];
}

const step = (id: string, kind: string, label: string, capability?: CapabilityId): WorkflowStep => ({
  id,
  kind,
  label,
  ...(capability ? { capability } : {}),
});

// ── Beépített sablonok (a MASTER §17 példái) ─────────────────────────────────

export const YOUTUBE_CREATOR: WorkflowTemplate = {
  id: 'youtube-creator',
  name: 'YouTube Creator',
  role: 'video',
  steps: [
    step('import', 'import', 'workflowTpl.step.import'),
    step('ai-select', 'ai-select', 'workflowTpl.step.aiSelect', 'autoEdit'),
    step('transcript', 'transcript', 'workflowTpl.step.transcript', 'autoCaption'),
    step('filler', 'filler-removal', 'workflowTpl.step.filler', 'autoEdit'),
    step('hook', 'hook', 'workflowTpl.step.hook', 'autoEdit'),
    step('captions', 'captions', 'workflowTpl.step.captions', 'autoCaption'),
    step('broll', 'broll', 'workflowTpl.step.broll'),
    step('color', 'color', 'workflowTpl.step.color', 'colorAi'),
    step('thumbnail', 'thumbnail', 'workflowTpl.step.thumbnail'),
    step('export', 'export', 'workflowTpl.step.export', 'localRender'),
    step('publish', 'publish', 'workflowTpl.step.publish'),
  ],
};

export const PODCAST_EPISODE: WorkflowTemplate = {
  id: 'podcast-episode',
  name: 'Podcast',
  role: 'podcaster',
  steps: [
    step('record', 'record', 'workflowTpl.step.record'),
    step('sync', 'sync', 'workflowTpl.step.sync'),
    step('clean', 'clean', 'workflowTpl.step.clean'),
    step('transcript', 'transcript', 'workflowTpl.step.transcript', 'autoCaption'),
    step('chapters', 'chapters', 'workflowTpl.step.chapters', 'autoEdit'),
    step('clips', 'clips', 'workflowTpl.step.clips', 'autoEdit'),
    step('audiogram', 'audiogram', 'workflowTpl.step.audiogram'),
    step('publish', 'publish', 'workflowTpl.step.publish'),
  ],
};

export const BUILT_IN_TEMPLATES: WorkflowTemplate[] = [YOUTUBE_CREATOR, PODCAST_EPISODE];

export function templateById(id: string): WorkflowTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

// ── Capability-gating (a katalógusból) ───────────────────────────────────────

/** A Pro-t igénylő lépések (a lépés `capability`-je + a katalógus `pro` mezője). */
export function templateProSteps(template: WorkflowTemplate): WorkflowStep[] {
  return template.steps.filter((s) => s.capability && capabilityRequiresPro(s.capability));
}

/** Igaz, ha a sablonban VAN Pro-t igénylő lépés. */
export function templateRequiresPro(template: WorkflowTemplate): boolean {
  return templateProSteps(template).length > 0;
}

// ── Futtatás ──────────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface RunStep extends WorkflowStep {
  status: StepStatus;
}

export interface WorkflowRun {
  id: string;
  templateId: string;
  name: string;
  steps: RunStep[];
  createdAt: string;
  updatedAt: string;
}

/** Futtatás indítása egy sablonból — minden lépés `pending`. */
export function startRun(template: WorkflowTemplate, makeId: () => string, now: string): WorkflowRun {
  return {
    id: makeId(),
    templateId: template.id,
    name: template.name,
    steps: template.steps.map((s) => ({ ...s, status: 'pending' })),
    createdAt: now,
    updatedAt: now,
  };
}

function mapStep(run: WorkflowRun, stepId: string, fn: (s: RunStep) => RunStep, now: string): WorkflowRun {
  let changed = false;
  const steps = run.steps.map((s) => {
    if (s.id !== stepId) {
      return s;
    }
    changed = true;
    return fn(s);
  });
  return changed ? { ...run, steps, updatedAt: now } : run;
}

export function markStep(run: WorkflowRun, stepId: string, status: StepStatus, now: string): WorkflowRun {
  return mapStep(run, stepId, (s) => ({ ...s, status }), now);
}

export const skipStep = (run: WorkflowRun, stepId: string, now: string): WorkflowRun => markStep(run, stepId, 'skipped', now);

/** A következő `pending` lépés (a futtatás előrehaladásához), vagy null. */
export function nextPendingStep(run: WorkflowRun): RunStep | null {
  return run.steps.find((s) => s.status === 'pending') ?? null;
}

/**
 * A soron következő pending lépést `running`-ra állítja (a többi érintetlen).
 * Ha nincs pending, változatlan.
 */
export function advanceRun(run: WorkflowRun, now: string): WorkflowRun {
  const next = nextPendingStep(run);
  return next ? markStep(run, next.id, 'running', now) : run;
}

export interface RunProgress {
  done: number;
  skipped: number;
  total: number;
  /** befejezett arány (done / total), 2 tizedesre */
  ratio: number;
}

export function runProgress(run: WorkflowRun): RunProgress {
  const done = run.steps.filter((s) => s.status === 'done').length;
  const skipped = run.steps.filter((s) => s.status === 'skipped').length;
  const total = run.steps.length;
  return { done, skipped, total, ratio: total ? Math.round((done / total) * 100) / 100 : 0 };
}

/** Kész, ha minden lépés done vagy skipped. */
export function isRunComplete(run: WorkflowRun): boolean {
  return run.steps.every((s) => s.status === 'done' || s.status === 'skipped');
}
