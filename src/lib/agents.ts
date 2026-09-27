/**
 * 🧠 AI Agent Marketplace (E-Agents — MASTER §25) — szerep-agentek, mind UGYANAZON
 * az API-n: READ → UNDERSTAND → PLAN → PROPOSE → APPROVE → COMMAND BUS → EXECUTE →
 * VERIFY. A meglévő AI Edit Engine ([aiCommands.ts](./aiCommands)) az alap; ez a
 * szerep-katalógus + a közös futtatási pipeline TISZTA modellje.
 *
 * Expo-mentes, immutábilis, determinisztikus.
 */

/** A közös agent-pipeline (a „PROPOSE→APPROVE→COMMAND BUS" a jóváhagyási kapu). */
export const AGENT_PIPELINE = ['read', 'understand', 'plan', 'propose', 'approve', 'execute', 'verify'] as const;
export type AgentStage = (typeof AGENT_PIPELINE)[number];

export interface RoleAgent {
  id: string;
  label: string;
  icon: string;
  /** melyik creator-szerepet szolgálja */
  role: string;
}

export const ROLE_AGENTS: RoleAgent[] = [
  { id: 'video-editor', label: 'Video Editor', icon: 'videocam', role: 'video' },
  { id: 'art-director', label: 'Art Director', icon: 'color-palette', role: 'designer' },
  { id: 'music-producer', label: 'Music Producer', icon: 'musical-notes', role: 'producer' },
  { id: 'photo-editor', label: 'Photo Editor', icon: 'image', role: 'photo' },
  { id: 'writing', label: 'Writing Agent', icon: 'document-text', role: 'writer' },
  { id: 'podcast-producer', label: 'Podcast Producer', icon: 'mic', role: 'podcaster' },
  { id: 'coding', label: 'Coding Agent', icon: 'code-slash', role: 'developer' },
  { id: 'social-media', label: 'Social Media Agent', icon: 'share-social', role: 'social' },
];

export function agentById(id: string): RoleAgent | undefined {
  return ROLE_AGENTS.find((a) => a.id === id);
}

// ── Futtatás (a közös pipeline) ───────────────────────────────────────────────

export type AgentStageStatus = 'pending' | 'active' | 'done';

export interface AgentRunStage {
  stage: AgentStage;
  status: AgentStageStatus;
}

export interface AgentRun {
  id: string;
  agentId: string;
  stages: AgentRunStage[];
  createdAt: string;
  updatedAt: string;
}

/** Futtatás indítása — az első fázis (`read`) aktív, a többi pending. */
export function startAgentRun(agentId: string, makeId: () => string, now: string): AgentRun {
  return {
    id: makeId(),
    agentId,
    stages: AGENT_PIPELINE.map((stage, i) => ({ stage, status: i === 0 ? 'active' : 'pending' })),
    createdAt: now,
    updatedAt: now,
  };
}

export function currentStage(run: AgentRun): AgentStage | null {
  return run.stages.find((s) => s.status === 'active')?.stage ?? null;
}

/** Az aktív fázist lezárja (done), a következőt aktiválja. Ha nincs több, változatlan. */
export function advanceAgentStage(run: AgentRun, now: string): AgentRun {
  const idx = run.stages.findIndex((s) => s.status === 'active');
  if (idx === -1) {
    return run;
  }
  const stages = run.stages.map((s, i) => {
    if (i === idx) {
      return { ...s, status: 'done' as const };
    }
    if (i === idx + 1) {
      return { ...s, status: 'active' as const };
    }
    return s;
  });
  return { ...run, stages, updatedAt: now };
}

export function isAgentComplete(run: AgentRun): boolean {
  return run.stages.every((s) => s.status === 'done');
}

export function agentProgress(run: AgentRun): number {
  const done = run.stages.filter((s) => s.status === 'done').length;
  return Math.round((done / run.stages.length) * 100) / 100;
}
