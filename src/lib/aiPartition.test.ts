import { partitionAiCommands, toEditorCommands, type AiCommand } from '@/lib/aiCommands';
import { createEmptyProject } from '@/lib/projectUtils';
import type { Project, VideoClip } from '@/types/project';

/** 🤖 PRO-VIDEO B17 — a jóváhagyott terv = ami lefut */

function proj(): Project {
  const p = createEmptyProject('x', '9:16');
  const v = { id: 'v1', kind: 'video', start: 0, duration: 5, uri: 'file:///v.mp4', trimIn: 0, sourceDuration: 5, speed: 1, volume: 1 } as VideoClip;
  return { ...p, tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [v] } : t)) };
}

describe('partitionAiCommands', () => {
  it('a hallucinált klip és a határon kívüli vágás okkal kiesik, a többi marad', () => {
    const cmds = [
      { type: 'UPDATE_CLIP', clipId: 'v1', patch: { volume: 0.5 } },
      { type: 'REMOVE_CLIP', clipId: 'ghost' },
      { type: 'SPLIT_CLIP', clipId: 'v1', time: 9 },
      { type: 'DROP_DATABASE' },
    ] as unknown as AiCommand[];
    const { accepted, rejected } = partitionAiCommands(cmds, proj());
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => r.code)).toEqual(['unknownClip', 'outOfRange', 'unknownType']);
  });

  it('a nem engedélyezett patch-mező leválik és jelezve van; a végrehajtás ugyanezt kapja', () => {
    const cmds = [{ type: 'UPDATE_CLIP', clipId: 'v1', patch: { volume: 0.5, uri: 'file:///evil' } }] as unknown as AiCommand[];
    const { accepted, rejected } = partitionAiCommands(cmds, proj());
    expect(rejected).toEqual([expect.objectContaining({ code: 'droppedFields', detail: 'uri' })]);
    expect((accepted[0] as { patch: Record<string, unknown> }).patch).toEqual({ volume: 0.5 });
    expect(toEditorCommands(accepted, proj())).toEqual([{ type: 'UPDATE_CLIP', clipId: 'v1', patch: { volume: 0.5 } }]);
  });
});
