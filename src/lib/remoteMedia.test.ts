import { applyCommand } from '@/lib/commands';
import { createEmptyProject } from '@/lib/projectUtils';
import { localNameFor, relinkCommands, remoteMediaUris } from '@/lib/remoteMedia';
import type { Project, VideoClip } from '@/types/project';

/** 🌐 PRO-VIDEO B28 — a remix-projekt távoli forrása exportálható lesz */

function remixProject(): Project {
  const p = createEmptyProject('Remix – x', '9:16');
  const url = 'https://cdn.remix.app/posts/abc/video.mp4?sig=1';
  const clip = { id: 'c', kind: 'video', start: 0, duration: 5, uri: url, assetId: 'a', trimIn: 0, sourceDuration: 5, speed: 1, volume: 1 } as VideoClip;
  return {
    ...p,
    assets: [{ id: 'a', kind: 'video', uri: url, provider: 'remote', remoteUrl: url }],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [clip] } : t)),
  };
}

describe('remoteMedia', () => {
  it('megtalálja a klipek által használt távoli forrásokat (egyszer)', () => {
    expect(remoteMediaUris(remixProject())).toEqual(['https://cdn.remix.app/posts/abc/video.mp4?sig=1']);
    expect(remoteMediaUris(createEmptyProject('x', '9:16'))).toEqual([]);
  });

  it('biztonságos helyi név (kiterjesztés megmarad, query nélkül)', () => {
    expect(localNameFor('https://x.y/a/b/My%20Clip.MOV?t=1', 2)).toBe('remote_2_My_Clip.mov');
    expect(localNameFor('https://x.y/', 0)).toBe('remote_0_remote.mp4');
  });

  it('a RELINK után nincs több távoli forrás — a natív terv is látja a klipet', () => {
    const p = remixProject();
    const [uri] = remoteMediaUris(p);
    const next = relinkCommands({ [uri]: 'file:///doc/Files/Projektek/r/remote_0_video.mp4' }).reduce(
      (acc, c) => applyCommand(acc, c) ?? acc,
      p
    );
    expect(remoteMediaUris(next)).toEqual([]);
    expect(next.assets[0].uri).toBe('file:///doc/Files/Projektek/r/remote_0_video.mp4');
  });
});
