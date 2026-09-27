import {
  CONTENT_PLATFORMS,
  calendarByDate,
  contentPlatform,
  isActive,
  nextStatus,
  plannerSummary,
  prevStatus,
  publishSchedule,
  stalledTasks,
  upcomingByPlatform,
  weekPlan,
} from '@/lib/planner';
import type { TaskStatus, WorkspaceTask } from '@/lib/workspace';

const NOW = '2026-09-27T12:00:00.000Z';

const task = (over: Partial<WorkspaceTask> & { id: string }): WorkspaceTask => ({
  title: over.id,
  status: 'idea',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('planner — platformok + pipeline', () => {
  it('7 tartalom-platform', () => {
    expect(CONTENT_PLATFORMS.map((p) => p.id)).toEqual([
      'youtube', 'tiktok', 'instagram', 'spotify', 'podcast', 'blog', 'newsletter',
    ]);
    expect(contentPlatform('tiktok')?.label).toBe('TikTok');
    expect(contentPlatform(undefined)).toBeUndefined();
  });

  it('nextStatus/prevStatus a pipeline mentén, a végeken önmaga', () => {
    expect(nextStatus('idea')).toBe('backlog');
    expect(nextStatus('published')).toBe('published');
    expect(prevStatus('idea')).toBe('idea');
    expect(prevStatus('editing')).toBe('production');
  });

  it('isActive csak a folyamatban lévőkre', () => {
    const active: TaskStatus[] = ['production', 'editing', 'review'];
    for (const s of active) {
      expect(isActive(s)).toBe(true);
    }
    expect(isActive('idea')).toBe(false);
    expect(isActive('published')).toBe(false);
  });
});

describe('planner — naptár', () => {
  const tasks = [
    task({ id: 'a', scheduledFor: '2026-09-28T10:00:00.000Z', platform: 'youtube' }),
    task({ id: 'b', scheduledFor: '2026-09-28T08:00:00.000Z', platform: 'tiktok' }),
    task({ id: 'c', scheduledFor: '2026-10-05T10:00:00.000Z' }),
    task({ id: 'd' }), // nincs scheduledFor
  ];

  it('calendarByDate nap szerint csoportosít, naponta időrendben', () => {
    const cal = calendarByDate(tasks);
    expect(Object.keys(cal).sort()).toEqual(['2026-09-28', '2026-10-05']);
    expect(cal['2026-09-28'].map((t) => t.id)).toEqual(['b', 'a']); // 08:00 előbb
  });

  it('range szűkít', () => {
    const cal = calendarByDate(tasks, { from: '2026-10-01T00:00:00.000Z' });
    expect(Object.keys(cal)).toEqual(['2026-10-05']);
  });
});

describe('planner — weekPlan / stalled / publish', () => {
  it('weekPlan a következő 7 nap ütemezett, nem-publikált feladatai', () => {
    const tasks = [
      task({ id: 'soon', scheduledFor: '2026-09-29T10:00:00.000Z' }),
      task({ id: 'far', scheduledFor: '2026-10-20T10:00:00.000Z' }),
      task({ id: 'done', status: 'published', scheduledFor: '2026-09-28T10:00:00.000Z' }),
      task({ id: 'past', scheduledFor: '2026-09-01T10:00:00.000Z' }),
    ];
    expect(weekPlan(tasks, NOW).map((t) => t.id)).toEqual(['soon']);
  });

  it('stalledTasks: aktív + rég nem érintett', () => {
    const tasks = [
      task({ id: 'stale', status: 'editing', updatedAt: '2026-09-10T00:00:00.000Z' }),
      task({ id: 'fresh', status: 'editing', updatedAt: '2026-09-26T00:00:00.000Z' }),
      task({ id: 'ideaOld', status: 'idea', updatedAt: '2026-01-01T00:00:00.000Z' }), // nem aktív
    ];
    expect(stalledTasks(tasks, NOW, 7).map((t) => t.id)).toEqual(['stale']);
  });

  it('publishSchedule: scheduled+published időrendben', () => {
    const tasks = [
      task({ id: 'p2', status: 'scheduled', scheduledFor: '2026-09-30T10:00:00.000Z' }),
      task({ id: 'p1', status: 'published', scheduledFor: '2026-09-20T10:00:00.000Z' }),
      task({ id: 'draft', status: 'editing', scheduledFor: '2026-09-25T10:00:00.000Z' }), // nem scheduled/published
    ];
    expect(publishSchedule(tasks).map((t) => t.id)).toEqual(['p1', 'p2']);
  });

  it('upcomingByPlatform platformonként csoportosít', () => {
    const tasks = [
      task({ id: 'yt', scheduledFor: '2026-09-29T10:00:00.000Z', platform: 'youtube' }),
      task({ id: 'tt', scheduledFor: '2026-09-30T10:00:00.000Z', platform: 'tiktok' }),
      task({ id: 'none', scheduledFor: '2026-09-29T12:00:00.000Z' }),
    ];
    const g = upcomingByPlatform(tasks, NOW);
    expect(g.youtube.map((t) => t.id)).toEqual(['yt']);
    expect(g.tiktok.map((t) => t.id)).toEqual(['tt']);
    expect(g.unassigned.map((t) => t.id)).toEqual(['none']);
  });
});

describe('planner — plannerSummary', () => {
  it('státusz-darabszám + scheduled/published/thisWeek/stalled', () => {
    const tasks = [
      task({ id: 'i', status: 'idea' }),
      task({ id: 's', status: 'scheduled', scheduledFor: '2026-09-29T10:00:00.000Z' }),
      task({ id: 'pub', status: 'published' }),
      task({ id: 'stale', status: 'review', updatedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const sum = plannerSummary(tasks, NOW);
    expect(sum.byStatus.idea).toBe(1);
    expect(sum.scheduled).toBe(1);
    expect(sum.published).toBe(1);
    expect(sum.thisWeek).toBe(1);
    expect(sum.stalled).toBe(1);
  });
});
