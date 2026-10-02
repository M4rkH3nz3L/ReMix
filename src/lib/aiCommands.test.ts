import { toEditorCommands, validateAiCommand, type AiCommand } from '@/lib/aiCommands';
import type { Project } from '@/types/project';

// minimál projekt: egy 'text' klip (c1): start 1, duration 4 → vége 5
const project = {
  name: 'teszt',
  aspectRatio: '9:16',
  tracks: [
    {
      type: 'text',
      clips: [
        { kind: 'text', id: 'c1', start: 1, duration: 4, text: 'hello', position: { x: 0.5, y: 0.3 } },
      ],
    },
  ],
} as unknown as Project;

describe('validateAiCommand — AI ≠ authorization boundary', () => {
  it('UPDATE_CLIP létező klipre, engedélyezett mezővel → ok', () => {
    const cmd: AiCommand = { type: 'UPDATE_CLIP', clipId: 'c1', patch: { text: 'új' } };
    expect(validateAiCommand(cmd, project).ok).toBe(true);
  });

  it('⚠️ UPDATE_CLIP NEM létező (hallucinált) klipre → elutasít', () => {
    const cmd: AiCommand = { type: 'UPDATE_CLIP', clipId: 'nincs', patch: { text: 'x' } };
    expect(validateAiCommand(cmd, project)).toMatchObject({ ok: false });
  });

  it('⚠️ UPDATE_CLIP csak nem-engedélyezett mezővel → elutasít', () => {
    const cmd: AiCommand = { type: 'UPDATE_CLIP', clipId: 'c1', patch: { id: 'hack', uri: 'file:///x' } };
    expect(validateAiCommand(cmd, project)).toMatchObject({ ok: false });
  });

  it('REMOVE_CLIP: létező → ok, nem létező → elutasít', () => {
    expect(validateAiCommand({ type: 'REMOVE_CLIP', clipId: 'c1' }, project).ok).toBe(true);
    expect(validateAiCommand({ type: 'REMOVE_CLIP', clipId: 'nincs' }, project).ok).toBe(false);
  });

  it('SPLIT_CLIP: határon belül → ok, kívül → elutasít', () => {
    expect(validateAiCommand({ type: 'SPLIT_CLIP', clipId: 'c1', time: 3 }, project).ok).toBe(true);
    expect(validateAiCommand({ type: 'SPLIT_CLIP', clipId: 'c1', time: 0.5 }, project).ok).toBe(false); // < start
    expect(validateAiCommand({ type: 'SPLIT_CLIP', clipId: 'c1', time: 6 }, project).ok).toBe(false); // > vége
  });

  it('ADD_TEXT_CLIPS: érvényes → ok; rossz trackType / üres → elutasít', () => {
    const good: AiCommand = {
      type: 'ADD_TEXT_CLIPS',
      trackType: 'captions',
      clips: [{ text: 'a', start: 0, duration: 2 }],
    };
    expect(validateAiCommand(good, project).ok).toBe(true);
    expect(
      validateAiCommand({ type: 'ADD_TEXT_CLIPS', trackType: 'hack' as never, clips: [{ text: 'a', start: 0, duration: 1 }] }, project).ok
    ).toBe(false);
    expect(validateAiCommand({ type: 'ADD_TEXT_CLIPS', trackType: 'text', clips: [] }, project).ok).toBe(false);
  });

  it('SET_ASPECT: érvényes képarány → ok, egyéb → elutasít', () => {
    expect(validateAiCommand({ type: 'SET_ASPECT', aspectRatio: '1:1' }, project).ok).toBe(true);
    expect(validateAiCommand({ type: 'SET_ASPECT', aspectRatio: '21:9' as never }, project).ok).toBe(false);
  });

  it('RENAME_PROJECT: nem-üres név → ok, üres → elutasít', () => {
    expect(validateAiCommand({ type: 'RENAME_PROJECT', name: 'Új név' }, project).ok).toBe(true);
    expect(validateAiCommand({ type: 'RENAME_PROJECT', name: '   ' }, project).ok).toBe(false);
  });

  it('⚠️ ismeretlen/privilegizált parancstípus (pl. DELETE_PROJECT) → elutasít', () => {
    const evil = { type: 'DELETE_PROJECT' } as unknown as AiCommand;
    expect(validateAiCommand(evil, project)).toMatchObject({ ok: false });
  });
});

describe('toEditorCommands — a validáción elbukó parancsok KIMARADNAK', () => {
  it('a hallucinált-klipes parancs kiesik, a valódi átmegy', () => {
    const commands: AiCommand[] = [
      { type: 'UPDATE_CLIP', clipId: 'nincs', patch: { text: 'x' } }, // elbukik
      { type: 'UPDATE_CLIP', clipId: 'c1', patch: { text: 'ok', id: 'hack' } }, // átmegy, id kiszűrve
    ];
    const out = toEditorCommands(commands, project);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'UPDATE_CLIP', clipId: 'c1' });
    // a nem-engedélyezett 'id' mező nem kerül a patch-be
    expect((out[0] as { patch: Record<string, unknown> }).patch).toEqual({ text: 'ok' });
  });

  it('ismeretlen parancstípus nem termel EditorCommand-ot', () => {
    const out = toEditorCommands([{ type: 'DELETE_PROJECT' } as unknown as AiCommand], project);
    expect(out).toHaveLength(0);
  });
});
