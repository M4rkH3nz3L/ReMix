import { buildRenderPlan, canRenderLocally } from '@/lib/nativeRender';
import { settingsNeedCloud, type RenderSettings } from '@/lib/render';
import type { Project, Track, VideoClip } from '@/types/project';

/**
 * 📱 FREE eszközön-render — a „korlátlan hossz" szerződés rögzítése.
 *
 * A termék-döntés: az ALAP MP4-export a TELEFONON, ingyen készül (localRender,
 * `pro: false`). Ehhez az kell, hogy a render-terv NE vágja le a hosszú
 * projekteket, és a >60 mp-es alap-projekt NE kerüljön automatikusan a Pro
 * felhő-renderre. Ez a teszt azt bizonyítja empirikusan, hogy a tervépítő
 * réteg semmilyen időkorlátot nem alkalmaz (a natív enkódolást csak eszközön
 * lehet ténylegesen lefuttatni — az AVFoundation/MediaCodec oldalon sincs cap).
 */

const DEFAULT_SETTINGS: RenderSettings = {
  resolution: 1080,
  fps: 30,
  quality: 'high',
  codec: 'h264',
};

function videoClip(id: string, start: number, duration: number): VideoClip {
  return {
    id,
    kind: 'video',
    start,
    duration,
    uri: `file:///clip-${id}.mp4`,
    trimIn: 0,
    sourceDuration: duration,
    speed: 1,
    volume: 1,
    filterId: 'none',
  };
}

function projectWithClips(clips: VideoClip[]): Project {
  const track: Track = { id: 'v0', type: 'video', name: 'Video', clips };
  return {
    id: 'p1',
    name: 'Hosszú videó',
    aspectRatio: '9:16',
    fps: 30,
    tracks: [track],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 4,
  };
}

describe('FREE eszközön-render — korlátlan hossz', () => {
  it('a 3 perces (180 mp) projekt MINDEN klipjét megtartja, nem vág le 60 mp-nél', () => {
    const clips = [
      videoClip('a', 0, 60),
      videoClip('b', 60, 60),
      videoClip('c', 120, 60),
    ];
    const plan = buildRenderPlan(projectWithClips(clips), DEFAULT_SETTINGS);

    // minden klip bekerült — semmit nem dobott el hossz miatt
    expect(plan.video).toHaveLength(3);

    // az idővonal vége a teljes 180 mp (nincs 60 mp-es csonkolás)
    const last = plan.video[plan.video.length - 1];
    expect(last.atSec + last.durationSec).toBe(180);

    // az összesen renderelt hossz jóval túl van a 60 mp-en
    const total = plan.video.reduce((s, seg) => s + seg.durationSec, 0);
    expect(total).toBe(180);
    expect(total).toBeGreaterThan(60);
  });

  it('egyetlen 5 perces (300 mp) klipet is sértetlenül átvesz', () => {
    const plan = buildRenderPlan(projectWithClips([videoClip('long', 0, 300)]), DEFAULT_SETTINGS);
    expect(plan.video).toHaveLength(1);
    expect(plan.video[0].durationSec).toBe(300);
  });

  it('a hosszú, alap-beállítású projekt ESZKÖZÖN renderelhető (nincs Pro-kényszer)', () => {
    const clips = [videoClip('a', 0, 90), videoClip('b', 90, 90)];
    const project = projectWithClips(clips);

    // van helyi videó → eszközön renderelhető
    expect(canRenderLocally(project, DEFAULT_SETTINGS)).toBe(true);

    // az alap-beállítás (H.264 / CRF / 1080p) NEM igényel felhőt — vagyis a
    // hossztól függetlenül a localRender (FREE) útra megy, nem a Pro-gate-re
    expect(settingsNeedCloud(DEFAULT_SETTINGS)).toBe(false);
  });
});
