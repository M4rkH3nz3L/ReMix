import { buildAiContext, contextToPrompt } from '@/lib/aiContext';
import type { Project } from '@/types/project';

const proj = (): Project =>
  ({
    id: 'p',
    name: 'Teszt projekt',
    aspectRatio: '9:16',
    fps: 30,
    seo: { title: 'Cím', hashtags: ['#remix', '#edit'] },
    tracks: [
      {
        id: 't1',
        type: 'video',
        name: 'v',
        clips: [
          { id: 'c1', kind: 'video', start: 0, duration: 4, uri: 'file:///a.mp4', trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' },
          { id: 'c2', kind: 'video', start: 4, duration: 4, uri: 'file:///b.mp4', trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' },
          { id: 'c3', kind: 'video', start: 30, duration: 4, uri: 'file:///c.mp4', trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' },
        ],
      },
      {
        id: 't2',
        type: 'captions',
        name: 'f',
        clips: [{ id: 'tx1', kind: 'text', start: 1, duration: 3, text: 'Helló világ ez egy nagyon hosszú felirat' }],
      },
    ],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 5,
  }) as unknown as Project;

describe('buildAiContext (audit §5.1)', () => {
  it('Global: projekt-meta + sáv-összegzés', () => {
    const ctx = buildAiContext(proj());
    expect(ctx.project).toMatchObject({ name: 'Teszt projekt', aspectRatio: '9:16', fps: 30, trackCount: 2 });
    expect(ctx.project.durationSec).toBe(34); // c3 vége: 30+4
    expect(ctx.tracks).toEqual([
      { type: 'video', clipCount: 3 },
      { type: 'captions', clipCount: 1 },
    ]);
    expect(ctx.seo).toEqual({ title: 'Cím', hashtags: ['#remix', '#edit'] });
  });

  it('Current: a kijelölt klip összegzése (címkével, nehéz mezők nélkül)', () => {
    const ctx = buildAiContext(proj(), { selectedClipId: 'tx1' });
    expect(ctx.selected).toMatchObject({ id: 'tx1', kind: 'text', track: 'captions', start: 1, end: 4 });
    expect(ctx.selected?.label).toContain('Helló világ');
    // nincs nyers mező a summary-ban
    expect(Object.keys(ctx.selected!).sort()).toEqual(['end', 'id', 'kind', 'label', 'start', 'track'].sort());
  });

  it('Relevant: a playhead körüli klipek (ablakon kívüli kimarad), a legközelebbi elöl', () => {
    const ctx = buildAiContext(proj(), { playhead: 2, windowSec: 10 });
    const ids = ctx.nearby.map((c) => c.id);
    expect(ids).toContain('c1'); // 0-4, átfed
    expect(ids).toContain('c2'); // 4-8, ablakon belül
    expect(ids).toContain('tx1'); // 1-4
    expect(ids).not.toContain('c3'); // 30-34, messze
    // a legközelebbi (a playheadhez) elöl: c1 közép=2, playhead=2 → dist 0
    expect(ids[0]).toBe('c1');
  });

  it('a kijelölt klip nem ismétlődik a nearby-ban', () => {
    const ctx = buildAiContext(proj(), { selectedClipId: 'c1', playhead: 2 });
    expect(ctx.nearby.map((c) => c.id)).not.toContain('c1');
  });

  it('maxNearby korlátoz', () => {
    const ctx = buildAiContext(proj(), { playhead: 2, windowSec: 100, maxNearby: 2 });
    expect(ctx.nearby.length).toBe(2);
  });
});

describe('contextToPrompt', () => {
  it('kompakt, olvasható szöveg a kulcs-infókkal', () => {
    const text = contextToPrompt(buildAiContext(proj(), { selectedClipId: 'tx1', playhead: 2 }));
    expect(text).toContain('Teszt projekt');
    expect(text).toContain('video×3');
    expect(text).toContain('#remix');
    expect(text).toContain('Kijelölt: text');
    expect(text.length).toBeLessThan(600); // token-hatékony
  });
});
