import { LOCAL_BLOCKERS, localRenderBlockers } from '@/lib/nativeRender';
import type { RenderSettings } from '@/lib/render';
import { LOCAL_RENDER_GAPS } from '@/lib/renderParity';
import type { AudioClip, Project, VideoClip } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
declare const __dirname: string;

// 🚪 VIDEO-PROD E1: a telefonos export nem futhat zsákutcába — minden ok, ami miatt felhő kell, NÉVEN jelenik meg

const settings: RenderSettings = { resolution: 1080, fps: 30, quality: 'high', codec: 'h264' };
const video: VideoClip = { id: 'v', kind: 'video', start: 0, duration: 4, uri: 'file:///v.mp4', trimIn: 0, sourceDuration: 4, speed: 1, volume: 1, filterId: 'none' };
const project = (extra: Partial<AudioClip> | null): Project => ({
  id: 'p', name: 'p', aspectRatio: '9:16', fps: 30, assets: [], createdAt: '', updatedAt: '', schemaVersion: 10,
  tracks: [
    { id: 'v0', type: 'video', name: 'Video', clips: [video] },
    { id: 'm0', type: 'music', name: 'Zene', clips: extra ? [{ id: 'a', kind: 'audio', start: 0, duration: 4, uri: 'file:///a.m4a', trimIn: 0, sourceDuration: 4, volume: 1, ...extra } as AudioClip] : [] },
  ],
});

describe('a telefonos render akadályai néven', () => {
  it('a visszafelé szóló hang megnevezett akadály; nélküle a hang nem akadály', () => {
    expect(localRenderBlockers(project({ reversed: true }), settings)).toContain('audioReverse');
    expect(localRenderBlockers(project({}), settings)).not.toContain('audioReverse');
  });
  it('üres fő videósáv: megnevezett akadály', () => {
    const p = project(null);
    p.tracks[0].clips = [];
    expect(localRenderBlockers(p, settings)).toContain('emptyVideo');
  });
});

describe('minden okhoz van felirat minden nyelven (a választó soha nem mutat nyers kulcsot)', () => {
  const keys = [...LOCAL_RENDER_GAPS, ...LOCAL_BLOCKERS, 'codec'];
  for (const lang of ['hu', 'en', 'de']) {
    it(lang, () => {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../i18n/locales/${lang}.json`), 'utf8'));
      const gap = d.panels.export.gap as Record<string, string>;
      expect(keys.filter((k) => typeof gap[k] !== 'string' || gap[k].length === 0)).toEqual([]);
      for (const k of ['parityTitle', 'parityMsgList', 'parityCloudCta', 'parityProCta']) {
        expect([k, typeof d.panels.export[k]]).toEqual([k, 'string']);
      }
      expect(d.panels.export.parityMsgList).toContain('{{list}}');
    });
  }
});
