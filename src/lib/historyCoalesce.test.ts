import { COALESCE_WINDOW_MS, coalesceKey, shouldCoalesce } from '@/lib/historyCoalesce';
import type { EditorCommand } from '@/lib/commands';

const upd = (clipId: string, patch: Record<string, unknown>) =>
  ({ type: 'UPDATE_CLIP', clipId, patch }) as EditorCommand;

describe('historyCoalesce', () => {
  it('ugyanaz a klip + ugyanazok a mezők → azonos kulcs (mező-sorrendtől függetlenül)', () => {
    expect(coalesceKey(upd('c1', { speed: 2, duration: 3 }))).toBe(coalesceKey(upd('c1', { duration: 4, speed: 1 })));
  });
  it('más klip vagy más mező → más kulcs', () => {
    expect(coalesceKey(upd('c1', { speed: 2 }))).not.toBe(coalesceKey(upd('c2', { speed: 2 })));
    expect(coalesceKey(upd('c1', { speed: 2 }))).not.toBe(coalesceKey(upd('c1', { volume: 1 })));
  });
  it('szerkezeti művelet sosem vonható össze', () => {
    expect(coalesceKey({ type: 'REMOVE_CLIP', clipId: 'c1' } as EditorCommand)).toBeNull();
    expect(coalesceKey({ type: 'SPLIT_CLIP', clipId: 'c1', time: 1 } as EditorCommand)).toBeNull();
  });
  it('időablak: belül összevon, kívül nem; null-kulcs soha', () => {
    const prev = { key: 'k', at: 1000 };
    expect(shouldCoalesce(prev, 'k', 1000 + COALESCE_WINDOW_MS)).toBe(true);
    expect(shouldCoalesce(prev, 'k', 1001 + COALESCE_WINDOW_MS)).toBe(false);
    expect(shouldCoalesce(prev, 'm', 1100)).toBe(false);
    expect(shouldCoalesce(prev, null, 1100)).toBe(false);
    expect(shouldCoalesce(null, 'k', 1100)).toBe(false);
  });
});
