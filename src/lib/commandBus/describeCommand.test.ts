import { describeCommand, type EditorCommand } from '@/lib/commands';
import { masterPreset } from '@/lib/audioMaster';
import { createImageDoc } from '@/lib/imageDoc';
import { createLiveDoc } from '@/lib/liveDoc';
import { asset, videoClip } from '@/test-utils/projectFixtures';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — a describeCommand címkéi (describeCommand).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('describeCommand — minden parancs ad nem-üres címkét', () => {
  const samples: EditorCommand[] = [
    { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') },
    { type: 'ADD_CLIPS', trackType: 'video', clips: [videoClip('a')] },
    { type: 'UPDATE_CLIP', clipId: 'a', patch: { duration: 2 } },
    { type: 'REMOVE_CLIP', clipId: 'a' },
    { type: 'SPLIT_CLIP', clipId: 'a', time: 2 },
    { type: 'SET_ASPECT', aspectRatio: '1:1' },
    { type: 'SET_FPS', fps: 24 },
    { type: 'RENAME_PROJECT', name: 'X' },
    { type: 'ADD_ASSET', asset: asset('a1', 'file:///a.mp4') },
    { type: 'UPDATE_ASSET', assetId: 'a1', patch: { favorite: true } },
    { type: 'REMOVE_ASSET', assetId: 'a1' },
    { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: [] },
    { type: 'REPLACE_TRACKS', tracks: [{ trackType: 'video', clips: [] }] },
    { type: 'RELINK_URI', oldUri: 'a', newUri: 'b' },
    { type: 'RELINK_ASSET', assetId: 'ast', newUri: 'b' },
    { type: 'SET_PARTICLES', particles: { preset: 'confetti', beatSync: true } },
    { type: 'SET_PARTICLES', particles: null },
    { type: 'SET_MARKERS', markers: [] },
    { type: 'SET_CHAPTERS', chapters: [] },
    { type: 'SET_AUDIO_MASTER', audioMaster: masterPreset('podcast') },
    { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 },
    { type: 'SET_REGIONS', regions: [] },
    { type: 'SET_LINKS', links: [['a', 'b']] },
    { type: 'UPSERT_IMAGE_DOC', doc: createImageDoc('K', '9:16', () => 'l1') },
    { type: 'REMOVE_IMAGE_DOC', docId: 'd1' },
    { type: 'SET_LIVE_DOC', doc: createLiveDoc('L', () => 'lv1') },
  ];
  it.each(samples.map((c) => [c.type, c] as const))('%s', (_type, cmd) => {
    const label = describeCommand(cmd);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});
