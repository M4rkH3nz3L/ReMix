import { stemClipsFrom } from '@/lib/stemClips';
import type { AudioClip } from '@/types/project';

const source: AudioClip = {
  kind: 'audio', id: 'c1', uri: 'file:///song.m4a', label: 'Dal', start: 4, duration: 6, trimIn: 10, sourceDuration: 60,
  volume: 0.7, fadeIn: 0.5, fadeOut: 1, pan: -0.3, source: 'imported', audioFx: { highpass: 80 }, assetId: 'a1',
};
const stems = [
  { name: 'vocals', url: 'https://w/vocals.wav' },
  { name: 'drums', url: 'https://w/drums.wav' },
];
let n = 0;
const build = () => stemClipsFrom(source, stems, () => `s${++n}`);

describe('stemClipsFrom (A3)', () => {
  it('a stem a teljes forrásból készül, így ugyanazt a szakaszt adja, mint a vágott klip', () => {
    const [{ clip }] = build();
    expect(clip).toMatchObject({ start: 4, duration: 6, trimIn: 10, sourceDuration: 60 });
  });

  it('a klip beállításai a stemekre is átkerülnek', () => {
    const [{ clip }] = build();
    expect(clip).toMatchObject({ volume: 0.7, fadeIn: 0.5, fadeOut: 1, pan: -0.3, audioFx: { highpass: 80 } });
  });

  it('új azonosítót és saját forrást kap, a régi asset nem tapad rá', () => {
    const [a, b] = build();
    expect(a.clip.id).not.toBe(b.clip.id);
    expect(a.clip.uri).toBe('https://w/vocals.wav');
    expect(a.clip.label).toBe('vocals');
    expect(a.clip.assetId).toBeUndefined();
  });

  it('az ének a voiceover sávra kerül, a többi az sfx-re', () => {
    const [a, b] = build();
    expect(a.trackType).toBe('voiceover');
    expect(a.clip.source).toBe('voiceover');
    expect(b.trackType).toBe('sfx');
    expect(b.clip.source).toBe('imported');
  });

  it('a hiányzó trimIn és sourceDuration a klipből adódik', () => {
    const plain: AudioClip = { ...source, trimIn: undefined, sourceDuration: undefined };
    const [{ clip }] = stemClipsFrom(plain, stems, () => 'x');
    expect(clip).toMatchObject({ trimIn: 0, sourceDuration: 6 });
  });
});
