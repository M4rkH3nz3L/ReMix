import { canDetachAudio, detachAudioCommands } from '@/lib/audioExtract';
import type { VideoClip } from '@/types/project';

const vclip = (over: Partial<VideoClip>): VideoClip =>
  ({
    id: 'v1',
    kind: 'video',
    uri: 'file:///movie.mp4',
    start: 2,
    duration: 5,
    trimIn: 0,
    sourceDuration: 5,
    speed: 1,
    volume: 1,
    filterId: 'none',
    ...over,
  }) as VideoClip;

describe('canDetachAudio', () => {
  it('normál sebességű, hangos klip → leválasztható (trimmelt is)', () => {
    expect(canDetachAudio(vclip({}))).toBe(true);
    expect(canDetachAudio(vclip({ trimIn: 1 }))).toBe(true); // trimIn átkerül az AudioClipre
  });
  it('gyorsított / néma klip → NEM', () => {
    expect(canDetachAudio(vclip({ speed: 2 }))).toBe(false);
    expect(canDetachAudio(vclip({ volume: 0 }))).toBe(false);
  });
});

describe('detachAudioCommands', () => {
  it('AudioClip a voiceover sávra + a videóklip elnémítása (egy köteg)', () => {
    const clip = vclip({ volume: 0.8, fadeInSec: 0.5, voiceEnhance: true, trimIn: 1.5, sourceDuration: 12 });
    const { audioClip, commands } = detachAudioCommands(clip, 'Detached');

    expect(audioClip.kind).toBe('audio');
    expect(audioClip.uri).toBe(clip.uri);
    expect(audioClip.start).toBe(clip.start);
    expect(audioClip.duration).toBe(clip.duration);
    expect(audioClip.trimIn).toBe(1.5); // a trim átkerül → a render korrekten szól
    expect(audioClip.sourceDuration).toBe(12);
    expect(audioClip.volume).toBe(0.8);
    expect(audioClip.fadeIn).toBe(0.5);
    expect(audioClip.source).toBe('voiceover');
    expect(audioClip.voiceEnhance).toBe(true);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ type: 'ADD_CLIP', trackType: 'voiceover' });
    expect(commands[1]).toMatchObject({ type: 'UPDATE_CLIP', clipId: 'v1', patch: { volume: 0 } });
  });
});
