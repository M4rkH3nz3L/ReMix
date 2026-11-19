import {
  addedClipIds,
  aiDenoiseCommands,
  assistantDenoiseIds,
  beatSplitCommands,
  CHORD_PART_VOLUME,
  CHORD_PART_WAVE,
  clipIdSet,
  duplicateCommands,
  findAudioClip,
  firstAudioClipWithUri,
  freeLaneAt,
  importedAudioClip,
  newMarker,
  nextCountInBars,
  nextMetronomeLevel,
  nextSnapMode,
  pasteTargetOf,
  pickChordLane,
  resetAiDenoisePatch,
  resetTunePatch,
  timelineWindow,
  trackTypeOfClip,
  tuneCommands,
} from '@/lib/audioStudioOps';
import { SECTION_KINDS } from '@/lib/audioMarkers';
import { projectTiming } from '@/lib/audioTransport';
import type { EditorCommand } from '@/lib/commands';
import type { AudioClip, Project, Track, TrackType } from '@/types/project';

const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'x', uri: 'file:///a.wav', label: 'a', start: 0, duration: 4, trimIn: 0, sourceDuration: 20, volume: 0.8, fadeIn: 0.1, fadeOut: 0.2, source: 'imported', ...over });
const track = (type: TrackType, clips: AudioClip[]): Track => ({ id: `trk_${type}`, type, name: type, clips }) as Track;
const proj = (tracks: Track[]): Pick<Project, 'tracks'> => ({ tracks });
let n = 0;
const makeId = (p: string) => `${p}_${++n}`;

beforeEach(() => {
  n = 0;
});

describe('audioStudioOps — sávok és kijelölés', () => {
  const p = proj([track('voiceover', [ac({ id: 'v1' })]), track('music', [ac({ id: 'm1', start: 2 })])]);

  it('trackTypeOfClip: a klip sávja, ismeretlennél undefined', () => {
    expect(trackTypeOfClip(p, 'm1')).toBe('music');
    expect(trackTypeOfClip(p, 'nincs')).toBeUndefined();
    expect(trackTypeOfClip(null, 'm1')).toBeUndefined();
  });

  it('pasteTargetOf: a kijelölt klip sávja, különben a tartalék (alapból a zene)', () => {
    expect(pasteTargetOf({ selectedClipId: 'v1', project: p })).toBe('voiceover');
    expect(pasteTargetOf({ selectedClipId: null, project: p })).toBe('music');
    expect(pasteTargetOf({ selectedClipId: 'nincs', project: p }, 'aux1')).toBe('aux1');
  });

  it('duplicateCommands: sávonként egy ADD_CLIPS, a másolat közvetlenül az eredeti után', () => {
    const cmds = duplicateCommands(p, ['v1', 'm1'], 30, () => makeId('clip'));
    expect(cmds.map((c) => c.type === 'ADD_CLIPS' && [c.trackType, c.clips.map((x) => [x.id, x.start])])).toEqual([
      ['voiceover', [['clip_1', 4]]],
      ['music', [['clip_2', 6]]],
    ]);
    expect(duplicateCommands(p, [], 30, () => 'x')).toEqual([]);
  });

  it('beatSplitCommands: 120 BPM 4/4-ben ütemenként, hátulról előre', () => {
    const timing = projectTiming({ bpm: 120 });
    const cmds = beatSplitCommands({ id: 'c', start: 0, duration: 6 }, timing, 'bar');
    expect(cmds).toEqual([
      { type: 'SPLIT_CLIP', clipId: 'c', time: 4 },
      { type: 'SPLIT_CLIP', clipId: 'c', time: 2 },
    ]);
  });

  it('clipIdSet / addedClipIds: az újonnan megjelent klipek', () => {
    const before = clipIdSet(p);
    const after = proj([...p.tracks, track('aux1', [ac({ id: 'new1' }), ac({ id: 'new2' })])]);
    expect(addedClipIds(after, before)).toEqual(['new1', 'new2']);
    expect(addedClipIds(null, before)).toEqual([]);
  });

  it('findAudioClip / firstAudioClipWithUri', () => {
    expect(findAudioClip(p, 'm1')?.start).toBe(2);
    expect(findAudioClip(p, 'nincs')).toBeUndefined();
    expect(firstAudioClipWithUri(p)?.id).toBe('v1');
  });
});

describe('audioStudioOps — kapcsolók', () => {
  it('nextSnapMode: ki → képkocka → ütem → ki', () => {
    expect(nextSnapMode('off')).toBe('frame');
    expect(nextSnapMode('frame')).toBe('beat');
    expect(nextSnapMode('beat')).toBe('off');
  });

  it('nextCountInBars: 0 → 1 → 2 → 0', () => {
    expect([0, 1, 2].map(nextCountInBars)).toEqual([1, 2, 0]);
  });

  it('nextMetronomeLevel: körbe jár, ismeretlen értékről az elsőre', () => {
    const levels = [0.35, 0.6, 1];
    expect(nextMetronomeLevel(levels, 0.35)).toBe(0.6);
    expect(nextMetronomeLevel(levels, 1)).toBe(0.35);
    expect(nextMetronomeLevel(levels, 0.5)).toBe(0.35);
  });

  it('newMarker: a szín a szakasz-fajták közt körbe jár', () => {
    const m = newMarker([], 'mk1', 3, 'A');
    expect(m).toEqual({ id: 'mk1', time: 3, label: 'A', color: SECTION_KINDS[0].color });
    const many = Array.from({ length: SECTION_KINDS.length }, (_, i) => ({ id: `m${i}`, time: i, label: '' }));
    expect(newMarker(many, 'x', 0, 'B').color).toBe(SECTION_KINDS[0].color);
  });

  it('timelineWindow: legalább 320 px, a látható ablak ± egy képernyő', () => {
    expect(timelineWindow(0, 50, { x: 0, w: 0 })).toEqual({ timelineW: 320, viewW: 1200, viewFrom: 0, viewTo: 5.6 });
    const w = timelineWindow(100, 10, { x: 500, w: 200 });
    expect(w).toEqual({ timelineW: 1040, viewW: 200, viewFrom: 30, viewTo: 90 });
  });
});

describe('audioStudioOps — klipek és parancsok', () => {
  it('importedAudioClip: az alapértékekkel (hangerő 1, fade nélkül)', () => {
    expect(importedAudioClip({ id: 'c', start: 1, duration: 2, uri: 'u', label: 'L' })).toEqual({
      kind: 'audio', id: 'c', start: 1, duration: 2, trimIn: 0, sourceDuration: 2, uri: 'u', label: 'L', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
    });
    expect(importedAudioClip({ id: 'c', start: 0, duration: 1, uri: 'u', label: 'L', volume: 0.6 }).volume).toBe(0.6);
  });

  it('freeLaneAt: az első szabad létező zene/aux sáv; ha nincs, egy új (névvel)', () => {
    const busy = proj([track('music', [ac({ id: 'm', start: 0, duration: 10 })]), track('aux1', [])]);
    expect(freeLaneAt(busy, 2, 1, 'Új')).toEqual({ start: 2, trackType: 'aux1' });
    expect(freeLaneAt(busy, 12, 1, 'Új')).toEqual({ start: 12, trackType: 'music' });
    const full = proj([track('music', [ac({ id: 'm', start: 0, duration: 10 })])]);
    expect(freeLaneAt(full, 2, 1, 'Új')).toEqual({ start: 2, trackType: 'aux1', newTrackName: 'Új' });
    expect(freeLaneAt(null, 0, 1, 'Új')).toEqual({ start: 0, trackType: 'music', newTrackName: 'Új' });
  });

  it('pickChordLane: akkord → zene; a többi az üres aux-ra, majd új sávra', () => {
    const p = proj([track('music', []), track('aux1', [])]);
    const lanes: TrackType[] = ['music', 'aux1'];
    const commands: EditorCommand[] = [];
    const newTrack = (type: TrackType): EditorCommand => ({ type: 'ADD_TRACK', track: { id: `t_${type}`, type, name: type, clips: [] } });
    expect(pickChordLane('chords', p, lanes, commands, newTrack)).toBe('music');
    expect(pickChordLane('bass', p, lanes, commands, newTrack)).toBe('aux1');
    commands.push({ type: 'ADD_CLIP', trackType: 'aux1', clip: ac({ id: 'b' }) });
    expect(pickChordLane('arp', p, lanes, commands, newTrack)).toBe('aux2');
    expect(lanes).toEqual(['music', 'aux1', 'aux2']);
    expect(commands.filter((c) => c.type === 'ADD_TRACK')).toHaveLength(1);
    expect(CHORD_PART_WAVE).toEqual({ chords: 'triangle', bass: 'sawtooth', arp: 'square' });
    expect(CHORD_PART_VOLUME).toEqual({ chords: 0.8, bass: 0.8, arp: 0.6, drums: 0.9 });
  });

  it('tuneCommands: hangolt fájl + harmónia az üres aux-sávra', () => {
    const clip = ac({ id: 'v', assetId: 'a0', label: 'Ének' });
    const p = proj([track('voiceover', [clip]), track('aux1', [])]);
    const { cmds, harmonyClipId } = tuneCommands(p, clip, { tunedUri: 't.wav', harmonyUri: 'h.wav', durationSec: 20 }, { root: 0, minor: true, strength: 0.8 }, clip.uri, { harmonyLane: 'Harmónia' }, makeId);
    expect(cmds.map((c) => c.type)).toEqual(['ADD_ASSET', 'UPDATE_CLIP', 'ADD_CLIP']);
    expect(cmds[1]).toMatchObject({ clipId: 'v', patch: { uri: 't.wav', tune: { sourceUri: clip.uri, sourceAssetId: 'a0', root: 0, minor: true, strength: 0.8 } } });
    expect(cmds[0]).toMatchObject({ asset: { name: 'Ének (hangolt)' } });
    expect(cmds[2]).toMatchObject({ trackType: 'aux1', clip: { id: harmonyClipId, volume: 0.8 * 0.7, label: 'Harmónia' } });
  });

  it('tuneCommands: üres aux nélkül új sáv a harmóniának; hangolt fájl nélkül nincs UPDATE', () => {
    const clip = ac({ id: 'v' });
    const p = proj([track('voiceover', [clip])]);
    const { cmds } = tuneCommands(p, clip, { tunedUri: null, harmonyUri: 'h.wav', durationSec: 5 }, { root: 2, minor: false, strength: 1, harmonySteps: 3 }, clip.uri, { harmonyLane: 'H' }, makeId);
    expect(cmds.map((c) => c.type)).toEqual(['ADD_TRACK', 'ADD_CLIP']);
    expect(cmds[0]).toMatchObject({ track: { type: 'aux1', name: 'H' } });
  });

  it('aiDenoiseCommands: az eredeti forrás a klipen marad (már szűrt klipnél annak forrása)', () => {
    const clip = ac({ id: 'c', uri: 'ai1.wav', assetId: 'ast_ai1', label: 'Hang', aiDenoise: { sourceUri: 'orig.wav', sourceAssetId: 'ast_orig', strength: 0.5 } });
    const cmds = aiDenoiseCommands(clip, { uri: 'ai2.wav', durationSec: 4 }, 1, 'ast_new');
    expect(cmds).toEqual([
      { type: 'ADD_ASSET', asset: { id: 'ast_new', kind: 'audio', uri: 'ai2.wav', provider: 'local', name: 'Hang (AI)', duration: 4 } },
      { type: 'UPDATE_CLIP', clipId: 'c', patch: { uri: 'ai2.wav', assetId: 'ast_new', aiDenoise: { sourceUri: 'orig.wav', sourceAssetId: 'ast_orig', strength: 1 } } },
    ]);
  });

  it('reset-patchek: az eredeti forrás vissza; nem feldolgozott klipnél null', () => {
    expect(resetAiDenoisePatch(ac({ aiDenoise: { sourceUri: 'o.wav', strength: 1 } }))).toEqual({ uri: 'o.wav', aiDenoise: undefined });
    expect(resetAiDenoisePatch(ac({}))).toBeNull();
    expect(resetTunePatch(ac({ tune: { sourceUri: 'o.wav', sourceAssetId: 'a', root: 0, minor: false, strength: 1 } }))).toEqual({ uri: 'o.wav', assetId: 'a', tune: undefined });
    expect(resetTunePatch(undefined)).toBeNull();
  });

  it('assistantDenoiseIds: a sávok hang-klipjei; a kijelölt, ha ott van és több jelölt lenne', () => {
    const p = proj([track('voiceover', [ac({ id: 'v1' }), ac({ id: 'v2' })]), track('music', [ac({ id: 'm1' })])]);
    expect(assistantDenoiseIds(p, ['voiceover'], null)).toEqual(['v1', 'v2']);
    expect(assistantDenoiseIds(p, ['voiceover'], { id: 'v2' })).toEqual(['v2']);
    expect(assistantDenoiseIds(p, ['voiceover'], { id: 'm1' })).toEqual(['v1', 'v2']);
    expect(assistantDenoiseIds(p, ['music'], { id: 'm1' })).toEqual(['m1']);
  });
});
