import { asCancelled, isRenderCancelledError, RenderCancelledError } from './cancel';
import { fileName, mediaUris } from './projectMedia';
import { DEFAULT_SETTINGS, PLATFORM_PRESETS, settingsNeedCloud, type RenderSettings } from './settings';
import { RenderCancelledError as BarrelCancelled } from '@/lib/render';
import type { Project } from '@/types/project';

// A `render` expo-mentes magja (REFACTOR): a barrelen át nem elérhető segédek (`asCancelled`,
// `DEFAULT_SETTINGS`, `fileName`, `mediaUris`) és a felhő-igény döntés jelenlegi viselkedése rögzítve.

const HD: RenderSettings = { resolution: 1080, fps: 30, quality: 'high' };

describe('renderPipeline/settings', () => {
  it('az alapbeállítás 1080p / 30 fps / high / h264', () => {
    expect(DEFAULT_SETTINGS).toEqual({ resolution: 1080, fps: 30, quality: 'high', codec: 'h264' });
  });

  it('a platform-presetek: 9:16 a rövid formátumoké, a YouTube 16:9 / 12 Mbps, az Instagram 4:5', () => {
    expect(Object.keys(PLATFORM_PRESETS)).toEqual(['tiktok', 'reels', 'shorts', 'youtube', 'instagram']);
    expect(PLATFORM_PRESETS.youtube).toEqual({
      label: 'YouTube',
      aspect: '16:9',
      settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 12 },
    });
    expect(PLATFORM_PRESETS.instagram.aspect).toBe('4:5');
    for (const k of ['tiktok', 'reels', 'shorts'] as const) {
      expect(PLATFORM_PRESETS[k].aspect).toBe('9:16');
      expect(PLATFORM_PRESETS[k].settings.bitrateMbps).toBe(10);
    }
  });

  it('settingsNeedCloud: h264/hevc, ≤4K, 8 bit, SDR, crf/vbr, GOP 0 → eszközön mehet', () => {
    expect(settingsNeedCloud(HD)).toBe(false);
    expect(settingsNeedCloud({ ...HD, codec: 'hevc', resolution: 2160, bitDepth: 8, bitrateMode: 'vbr', gop: 0 })).toBe(false);
    expect(settingsNeedCloud({ ...HD, hdr: false, colorSpace: 'rec709', bitrateMode: 'crf', gop: -5 })).toBe(false);
  });

  it('settingsNeedCloud: av1/prores, >4K, 10 bit, HDR, Rec.2020, CBR, egyedi GOP → felhő', () => {
    for (const extra of [
      { codec: 'av1' },
      { codec: 'prores' },
      { resolution: 2161 },
      { bitDepth: 10 },
      { hdr: true },
      { colorSpace: 'rec2020' },
      { bitrateMode: 'cbr' },
      { gop: 1 },
    ] as Partial<RenderSettings>[]) {
      expect([extra, settingsNeedCloud({ ...HD, ...extra })]).toEqual([extra, true]);
    }
  });
});

describe('renderPipeline/cancel', () => {
  it('a barrel ugyanazt az osztályt adja (instanceof az importálókon át)', () => {
    expect(BarrelCancelled).toBe(RenderCancelledError);
    const e = new RenderCancelledError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('RenderCancelledError');
  });

  it('isRenderCancelledError: osztály VAGY név szerint (a natív modul hibája is)', () => {
    expect(isRenderCancelledError(new RenderCancelledError())).toBe(true);
    expect(isRenderCancelledError({ name: 'RenderCancelledError' })).toBe(true);
    expect(isRenderCancelledError(new Error('x'))).toBe(false);
    expect(isRenderCancelledError(null)).toBe(false);
    expect(isRenderCancelledError('RenderCancelledError')).toBe(false);
  });

  it('asCancelled: megszakított jelnél RenderCancelledError, különben az eredeti hiba', () => {
    const raw = new Error('AbortError');
    const ac = new AbortController();
    expect(asCancelled(raw)).toBe(raw);
    expect(asCancelled(raw, ac.signal)).toBe(raw);
    ac.abort();
    expect(asCancelled(raw, ac.signal)).toBeInstanceOf(RenderCancelledError);
  });
});

describe('renderPipeline/projectMedia', () => {
  it('fileName: az utolsó útvonal-elem a query nélkül', () => {
    expect(fileName('file:///a/b/klip.mp4?x=1&y=2')).toBe('klip.mp4');
    expect(fileName('klip.mp4')).toBe('klip.mp4');
    expect(fileName('file:///a/b/')).toBe('');
  });

  it('mediaUris: videó/kép/hang + alakzat-kép + matte + LUT, egyszer, első-előfordulás sorrendben', () => {
    const project = {
      tracks: [
        {
          clips: [
            { kind: 'video', uri: 'v.mp4', matte: { uri: 'm.png' }, adjust: { lut: { uri: 'l.cube' } } },
            { kind: 'text', uri: 'nem-media' },
            { kind: 'shape', imageUri: 's.png' },
            { kind: 'shape' },
            { kind: 'image', uri: 'i.jpg', matte: {} },
            { kind: 'video', uri: 'v.mp4' },
          ],
        },
        { clips: [{ kind: 'audio', uri: 'a.m4a', adjust: {} }] },
      ],
    } as unknown as Project;
    expect(mediaUris(project)).toEqual(['v.mp4', 'm.png', 'l.cube', 's.png', 'i.jpg', 'a.m4a']);
  });
});
