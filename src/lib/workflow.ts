import type { Project } from '@/types/project';

/**
 * 🎬 Pro Workflow — a profi szerkesztés szakasz-rendszere. Nem új funkció, hanem
 * egy RÉTEG a meglévő eszközök fölé: a „nagy toolbar" helyett a klasszikus NLE-
 * folyamat (Import → Organize → Rough/Fine cut → Audio → Color → Motion →
 * Captions → QC → Export) szakaszaira bontja a munkát, és a projekt-állapotból
 * kiszámolja, hol tartasz. Pure (csak típus-import) → tesztelhető; a végrehajtás
 * a meglévő paneleken/parancsokon megy.
 */

export type WorkflowStageId =
  | 'import'
  | 'organize'
  | 'roughcut'
  | 'finecut'
  | 'audio'
  | 'color'
  | 'motion'
  | 'captions'
  | 'qc'
  | 'export';

export interface WorkflowStage {
  id: WorkflowStageId;
  /** Ionicons-név a szakasz-lépcsőhöz */
  icon: string;
  /** a szakaszhoz nyíló meglévő panelek (setPanel-hez); üres = a szakasz saját UI-ja */
  panels: string[];
}

/** A 10 szakasz, a profi vágás sorrendjében. */
export const WORKFLOW_STAGES: WorkflowStage[] = [
  { id: 'import', icon: 'download-outline', panels: ['library'] },
  { id: 'organize', icon: 'folder-open-outline', panels: [] },
  { id: 'roughcut', icon: 'cut-outline', panels: ['assistant'] },
  { id: 'finecut', icon: 'options-outline', panels: ['precision', 'transition', 'speed'] },
  { id: 'audio', icon: 'musical-notes-outline', panels: ['audio'] },
  { id: 'color', icon: 'color-palette-outline', panels: ['adjust'] },
  { id: 'motion', icon: 'sparkles-outline', panels: ['shape', 'text', 'pip'] },
  { id: 'captions', icon: 'chatbox-ellipses-outline', panels: ['captions'] },
  { id: 'qc', icon: 'shield-checkmark-outline', panels: ['assistant'] },
  { id: 'export', icon: 'share-outline', panels: ['export'] },
];

/**
 * Szakasz-állapot a PROJEKTBŐL kiszámolva (nem gate, hanem iránymutatás): melyik
 * szakaszban van már érdemi tartalom. A QC emberi lépés → nincs automatikus jele.
 */
export function stageStatus(project: Project): Record<WorkflowStageId, boolean> {
  const clips = project.tracks.flatMap((t) => t.clips);
  const trackClips = (type: string) =>
    project.tracks.find((t) => t.type === type)?.clips ?? [];
  const videoClips = trackClips('video');
  const assets = project.assets ?? [];

  const has = <T>(arr: T[], pred: (x: T) => boolean) => arr.some(pred);
  // laza mező-olvasás (a klip-uniók heterogének)
  const f = (c: unknown, k: string): unknown => (c as Record<string, unknown>)[k];

  const colorDone =
    has(clips, (c) => c.kind === 'adjust') ||
    has(clips, (c) => f(c, 'adjust') != null) ||
    has(clips, (c) => {
      const id = f(c, 'filterId');
      return typeof id === 'string' && id !== 'none';
    });

  const motionDone =
    has(clips, (c) => c.kind === 'text' || c.kind === 'shape') ||
    trackClips('pip').length > 0 ||
    has(clips, (c) => f(c, 'keyframes') != null || f(c, 'textMotion') != null);

  const audioDone =
    has(clips, (c) => c.kind === 'audio') ||
    has(videoClips, (c) => {
      const v = f(c, 'volume');
      return typeof v === 'number' && v !== 1;
    });

  const fineCutDone =
    videoClips.length >= 2 ||
    has(videoClips, (c) => f(c, 'transitionOut') != null) ||
    has(videoClips, (c) => {
      const t = f(c, 'trimIn');
      return typeof t === 'number' && t > 0;
    });

  return {
    import: assets.length > 0 || clips.length > 0,
    organize: has(
      assets,
      (a) => a.favorite === true || (a.rating ?? 0) > 0 || (a.tags?.length ?? 0) > 0
    ),
    roughcut: videoClips.length >= 1,
    finecut: fineCutDone,
    audio: audioDone,
    color: colorDone,
    motion: motionDone,
    captions: trackClips('captions').length > 0,
    qc: false, // emberi ellenőrzési lépés — nincs megbízható automatikus jele
    export: project.rendered != null,
  };
}

/** A javasolt AKTUÁLIS szakasz: az első, ami még nincs kész (a folyamat sorrendjében). */
export function currentStage(status: Record<WorkflowStageId, boolean>): WorkflowStageId {
  const next = WORKFLOW_STAGES.find((s) => !status[s.id]);
  return next ? next.id : 'export';
}
