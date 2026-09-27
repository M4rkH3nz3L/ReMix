import {
  BUILT_IN_TEMPLATES,
  PODCAST_EPISODE,
  YOUTUBE_CREATOR,
  advanceRun,
  isRunComplete,
  markStep,
  nextPendingStep,
  runProgress,
  skipStep,
  startRun,
  templateById,
  templateProSteps,
  templateRequiresPro,
} from '@/lib/workflowTemplate';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const mkIder = () => {
  let n = 0;
  return () => `run${++n}`;
};

describe('workflowTemplate — beépített sablonok', () => {
  it('YouTube Creator a MASTER-lánc lépéseivel', () => {
    expect(YOUTUBE_CREATOR.steps.map((s) => s.kind)).toEqual([
      'import', 'ai-select', 'transcript', 'filler-removal', 'hook', 'captions', 'broll', 'color', 'thumbnail', 'export', 'publish',
    ]);
  });
  it('Podcast-lánc', () => {
    expect(PODCAST_EPISODE.steps.map((s) => s.kind)).toEqual([
      'record', 'sync', 'clean', 'transcript', 'chapters', 'clips', 'audiogram', 'publish',
    ]);
  });
  it('templateById + BUILT_IN', () => {
    expect(templateById('youtube-creator')).toBe(YOUTUBE_CREATOR);
    expect(templateById('nope')).toBeUndefined();
    expect(BUILT_IN_TEMPLATES).toHaveLength(2);
  });
});

describe('workflowTemplate — capability-gating (katalógusból)', () => {
  it('a Pro-lépések a katalógus pro-mezőjéből jönnek (export/localRender NEM pro)', () => {
    const pro = templateProSteps(YOUTUBE_CREATOR).map((s) => s.id);
    expect(pro).toEqual(expect.arrayContaining(['ai-select', 'transcript', 'captions', 'color']));
    expect(pro).not.toContain('export'); // localRender = local/free
    expect(pro).not.toContain('import'); // nincs capability
    expect(pro).not.toContain('publish');
  });
  it('mindkét sablon igényel Prót', () => {
    expect(templateRequiresPro(YOUTUBE_CREATOR)).toBe(true);
    expect(templateRequiresPro(PODCAST_EPISODE)).toBe(true);
  });
});

describe('workflowTemplate — futtatás', () => {
  it('startRun minden lépést pending-re', () => {
    const run = startRun(YOUTUBE_CREATOR, mkIder(), T0);
    expect(run.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(run.templateId).toBe('youtube-creator');
    expect(nextPendingStep(run)!.id).toBe('import');
  });

  it('advanceRun a soron következő pending-et running-ra teszi', () => {
    let run = startRun(YOUTUBE_CREATOR, mkIder(), T0);
    run = advanceRun(run, T1);
    expect(run.steps[0].status).toBe('running');
    expect(nextPendingStep(run)!.id).toBe('ai-select'); // a running már nem pending
  });

  it('markStep + skipStep + runProgress + isRunComplete', () => {
    let run = startRun(PODCAST_EPISODE, mkIder(), T0);
    // minden lépést lezárunk (done vagy skip)
    for (const s of run.steps) {
      run = s.kind === 'clean' ? skipStep(run, s.id, T1) : markStep(run, s.id, 'done', T1);
    }
    const p = runProgress(run);
    expect(p.total).toBe(8);
    expect(p.done).toBe(7);
    expect(p.skipped).toBe(1);
    expect(p.ratio).toBeCloseTo(0.88, 2);
    expect(isRunComplete(run)).toBe(true);
  });

  it('nincs pending → advanceRun no-op', () => {
    let run = startRun({ id: 't', name: 't', steps: [{ id: 's', kind: 'x', label: 'x' }] }, mkIder(), T0);
    run = markStep(run, 's', 'done', T1);
    expect(advanceRun(run, T1)).toBe(run);
    expect(nextPendingStep(run)).toBeNull();
  });
});
