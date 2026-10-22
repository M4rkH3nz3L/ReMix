import { toEditorCommands, validateAiCommand } from '@/lib/aiCommands';
import { parseLocalIntent, type LocalIntentContext } from '@/lib/localIntent';
import type { Project, Track, VideoClip } from '@/types/project';

/**
 * 🧩 Lokális szándék-parser (local-ai Fázis C): csak magabiztos találat, a
 * kimenet átmegy a VALÓDI validateAiCommand határon, minden másra null (→ worker).
 */

function fixture(): Project {
  const clip: VideoClip = {
    kind: 'video',
    id: 'clip_a',
    start: 0,
    duration: 10,
    uri: 'file://a.mp4',
    trimIn: 0,
    sourceDuration: 10,
    speed: 1,
    volume: 1,
    filterId: 'none',
  };
  const video: Track = { id: 't_v', type: 'video', name: 'Videó', clips: [clip] };
  return {
    id: 'p1',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps: 30,
    tracks: [video],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

function ctx(partial: Partial<LocalIntentContext> = {}): LocalIntentContext {
  return { project: fixture(), playhead: 5, selectedClipId: null, ...partial };
}

describe('parseLocalIntent — magabiztos minták', () => {
  it('vágás időponttal: „vágd ketté 4 másodpercnél" → SPLIT_CLIP', () => {
    const r = parseLocalIntent('vágd ketté 4 másodpercnél', ctx())!;
    expect(r.commands).toEqual([{ type: 'SPLIT_CLIP', clipId: 'clip_a', time: 4 }]);
  });

  it('vágás playheadnél: „vágd el itt" → a playhead ideje', () => {
    const r = parseLocalIntent('vágd el itt', ctx({ playhead: 3.5 }))!;
    expect(r.commands[0]).toEqual({ type: 'SPLIT_CLIP', clipId: 'clip_a', time: 3.5 });
  });

  it('mm:ss formátum: „cut at 0:06"', () => {
    const r = parseLocalIntent('cut at 0:06', ctx())!;
    expect(r.commands[0]).toEqual({ type: 'SPLIT_CLIP', clipId: 'clip_a', time: 6 });
  });

  it('törlés csak kijelöléssel: enélkül null, azzal REMOVE_CLIP', () => {
    expect(parseLocalIntent('töröld a klipet', ctx())).toBeNull();
    const r = parseLocalIntent('töröld a klipet', ctx({ selectedClipId: 'clip_a' }))!;
    expect(r.commands[0]).toEqual({ type: 'REMOVE_CLIP', clipId: 'clip_a' });
  });

  it('képarány: „állítsd 16:9-re" → SET_ASPECT', () => {
    const r = parseLocalIntent('állítsd 16:9-re a képarányt', ctx())!;
    expect(r.commands[0]).toEqual({ type: 'SET_ASPECT', aspectRatio: '16:9' });
  });

  it('átnevezés idézett névvel; idézet nélkül null', () => {
    const r = parseLocalIntent('nevezd át erre: „Nyári vlog”', ctx())!;
    expect(r.commands[0]).toEqual({ type: 'RENAME_PROJECT', name: 'Nyári vlog' });
    expect(parseLocalIntent('nevezd át', ctx())).toBeNull();
  });

  it('felirat idézett szöveggel a playheadnél', () => {
    const r = parseLocalIntent('írd ki feliratnak: „Kövess be!”', ctx({ playhead: 2 }))!;
    const cmd = r.commands[0];
    expect(cmd.type).toBe('ADD_TEXT_CLIPS');
    expect(cmd.trackType).toBe('captions');
    expect(cmd.clips?.[0]).toMatchObject({ text: 'Kövess be!', start: 2 });
  });

  it('sebesség: „gyorsítsd 2x-re" a kijelölt klipen', () => {
    const r = parseLocalIntent('gyorsítsd 2x-re', ctx({ selectedClipId: 'clip_a' }))!;
    expect(r.commands[0]).toEqual({
      type: 'UPDATE_CLIP',
      clipId: 'clip_a',
      patch: { speed: 2 },
    });
  });

  it('némítás a kijelölt klipen', () => {
    const r = parseLocalIntent('némítsd le', ctx({ selectedClipId: 'clip_a' }))!;
    expect(r.commands[0]).toEqual({
      type: 'UPDATE_CLIP',
      clipId: 'clip_a',
      patch: { volume: 0 },
    });
  });
});

describe('parseLocalIntent — határok', () => {
  it('minden kimenet átmegy a validateAiCommand + toEditorCommands határon', () => {
    const project = fixture();
    const samples = [
      'vágd ketté 4 másodpercnél',
      'állítsd 9:16-ra',
      'írd ki: „Helló”',
    ];
    for (const s of samples) {
      const r = parseLocalIntent(s, ctx())!;
      for (const cmd of r.commands) {
        expect(validateAiCommand(cmd, project).ok).toBe(true);
      }
      expect(toEditorCommands(r.commands, project).length).toBeGreaterThan(0);
    }
  });

  it('bizonytalan/összetett kérésre null (→ worker-út)', () => {
    expect(parseLocalIntent('csinálj valami ütőset a videóból', ctx())).toBeNull();
    expect(parseLocalIntent('vágd meg úgy, hogy jobb ritmusa legyen', ctx())).toBeNull(); // nincs időpont
    expect(parseLocalIntent('', ctx())).toBeNull();
    expect(parseLocalIntent('x'.repeat(250), ctx())).toBeNull();
  });

  it('klip-határon kívüli vágás → null (nem ad érvénytelen parancsot)', () => {
    expect(parseLocalIntent('vágd ketté 15 másodpercnél', ctx())).toBeNull();
  });

  it('determinista: azonos bemenet → azonos kimenet', () => {
    const a = parseLocalIntent('vágd ketté 4 mp-nél', ctx());
    const b = parseLocalIntent('vágd ketté 4 mp-nél', ctx());
    expect(a).toEqual(b);
  });
});
