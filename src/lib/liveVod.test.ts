import { buildVodClip, buildVodProject } from '@/lib/liveVod';
import { projectKind } from '@/lib/projectUtils';
import { secToFrame, snapToFrame } from '@/lib/frames';
import type { VideoClip } from '@/types/project';

/** determinisztikus klip-id generátor. */
function idGen(): () => string {
  let n = 0;
  return () => `clip_${++n}`;
}

describe('liveVod — buildVodClip (pure)', () => {
  it('a VOD-URL a klip uri-ja; a klip a fő videosáv elejéről indul (start=0)', () => {
    const clip = buildVodClip({ vodUrl: 'https://cdn/vod.mp4', durationSec: 12, fps: 30, makeId: idGen() });
    expect(clip.kind).toBe('video');
    expect(clip.uri).toBe('https://cdn/vod.mp4');
    expect(clip.start).toBe(0);
    expect(clip.trimIn).toBe(0);
    expect(clip.speed).toBe(1);
    expect(clip.volume).toBe(1);
    expect(clip.filterId).toBe('none');
  });

  it('a duration/sourceDuration a frame-rácson ül (becsült hossz → snap)', () => {
    const fps = 30;
    // 12.019 mp nem egész képkocka → a frame-rácsra kerekítve
    const clip = buildVodClip({ vodUrl: 'u', durationSec: 12.019, fps, makeId: idGen() });
    expect(clip.duration).toBe(snapToFrame(12.019, fps));
    expect(clip.sourceDuration).toBe(clip.duration);
    // a frame-rácson ülés bizonyítéka: egész képkocka-szám
    expect(Number.isInteger(secToFrame(clip.duration, fps))).toBe(true);
  });

  it('nulla/negatív hossz → legalább egy képkocka (nincs 0 hosszú klip)', () => {
    const fps = 25;
    const clip = buildVodClip({ vodUrl: 'u', durationSec: 0, fps, makeId: idGen() });
    expect(clip.duration).toBeGreaterThan(0);
    expect(clip.duration).toBe(snapToFrame(1 / fps, fps));
  });
});

describe('liveVod — buildVodProject (command-bus)', () => {
  it('kind:video projekt, a VOD-klip a fő videosávon (ADD_CLIP)', () => {
    const p = buildVodProject({
      vodUrl: 'https://cdn/vod.mp4',
      durationSec: 20,
      fps: 30,
      makeId: idGen(),
      name: 'Esti adás',
    });
    expect(projectKind(p)).toBe('video');
    expect(p.name).toBe('Esti adás');
    const videoTrack = p.tracks.find((t) => t.type === 'video');
    expect(videoTrack).toBeDefined();
    expect(videoTrack!.clips).toHaveLength(1);
    const clip = videoTrack!.clips[0] as VideoClip;
    expect(clip.kind).toBe('video');
    expect(clip.uri).toBe('https://cdn/vod.mp4');
    expect(clip.start).toBe(0);
    // a klip a PROJEKT fps-ére (30) ült → egész képkocka
    expect(Number.isInteger(secToFrame(clip.duration, 30))).toBe(true);
  });

  it('a klip a projekt frame-rácsára ül (a projekt fps-e a mérvadó)', () => {
    const p = buildVodProject({
      vodUrl: 'u',
      durationSec: 7.333,
      fps: 30,
      makeId: idGen(),
      name: 'x',
    });
    const clip = (p.tracks.find((t) => t.type === 'video')!.clips[0]) as VideoClip;
    expect(clip.duration).toBe(snapToFrame(7.333, 30));
  });

  it('üres/whitespace név → fallback „Live felvétel"', () => {
    const p = buildVodProject({ vodUrl: 'u', durationSec: 5, fps: 30, makeId: idGen(), name: '   ' });
    expect(p.name).toBe('Live felvétel');
  });
});
