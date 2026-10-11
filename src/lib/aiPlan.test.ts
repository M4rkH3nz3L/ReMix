import type { TFunction } from 'i18next';

import type { AiCommand } from '@/lib/aiCommands';
import { describeAiPlan } from '@/lib/aiPlan';
import type { Clip, Project, VideoClip } from '@/types/project';

// 🤖 AI terv-előnézet (parancslista → tételes, feloldott terv a jóváhagyó UI-nak)
// pure pajzsa. A `t`-t stubként adjuk (a kulcsot adja vissza).

const t = ((k: string) => k) as unknown as TFunction;

const vclip = (id: string, start: number, duration: number): VideoClip =>
  ({ id, kind: 'video', start, duration, uri: 'v', trimIn: 0, speed: 1, sourceDuration: duration, volume: 1, filterId: 'none' } as VideoClip);

const project = (clips: Clip[]): Project =>
  ({
    id: 'p', name: 'T', aspectRatio: '9:16', fps: 30,
    tracks: [{ id: 't', type: 'video', name: 'v', clips }],
    assets: [], createdAt: '', updatedAt: '', schemaVersion: 6,
  } as unknown as Project);

const cmds = (...c: unknown[]) => c as AiCommand[];

describe('describeAiPlan', () => {
  const proj = project([vclip('a', 2, 3)]); // „video (2–3s)" → vég 5

  it('UPDATE_CLIP: feloldott klip-ref + mezőnkénti diff + playhead a klip kezdetén', () => {
    const [item] = describeAiPlan(
      cmds({ type: 'UPDATE_CLIP', clipId: 'a', patch: { speed: 1.5, volume: 0.5 }, reason: 'punchier' }),
      proj,
      t
    );
    expect(item.time).toBe(2);
    expect(item.clipId).toBe('a');
    expect(item.reason).toBe('punchier');
    expect(item.detail).toContain('2–5s');
    expect(item.detail).toContain('1×→1.5×');
    expect(item.detail).toContain('100%→50%');
  });

  it('REMOVE_CLIP: a klip-ref a detail, time a kezdet', () => {
    const [item] = describeAiPlan(cmds({ type: 'REMOVE_CLIP', clipId: 'a' }), proj, t);
    expect(item.detail).toContain('video (2–5s)');
    expect(item.time).toBe(2);
  });

  it('SPLIT_CLIP: a vágás ideje', () => {
    const [item] = describeAiPlan(cmds({ type: 'SPLIT_CLIP', clipId: 'a', time: 3.5 }), proj, t);
    expect(item.time).toBe(3.5);
    expect(item.clipId).toBe('a');
  });

  it('ADD_TEXT_CLIPS: az első 3 szöveg előnézete, time az első kezdete', () => {
    const [item] = describeAiPlan(
      cmds({ type: 'ADD_TEXT_CLIPS', trackType: 'text', clips: [
        { text: 'Hello világ', start: 1 }, { text: 'Második', start: 2 },
      ] }),
      proj,
      t
    );
    expect(item.time).toBe(1);
    expect(item.detail).toContain('Hello világ');
    expect(item.detail).toContain('Második');
  });

  it('SET_ASPECT / RENAME_PROJECT: cím, nincs időpont', () => {
    const [aspect, rename] = describeAiPlan(
      cmds({ type: 'SET_ASPECT', aspectRatio: '1:1' }, { type: 'RENAME_PROJECT', name: 'Új' }),
      proj,
      t
    );
    expect(aspect.time).toBeNull();
    expect(rename.time).toBeNull();
  });

  it('ismeretlen klip-id → unknownClip ref, time null', () => {
    const [item] = describeAiPlan(cmds({ type: 'REMOVE_CLIP', clipId: 'nope' }), proj, t);
    expect(item.detail).toContain('unknownClip');
    expect(item.time).toBeNull();
  });
});
