import {
  BASE_MBPS,
  buildRenderSettings,
  CODECS,
  estimateExportMb,
  FPS_OPTIONS,
  QUALITIES,
  QUALITY_MULT,
  RESOLUTIONS,
  toggleBatchPlatform,
  type ExportChipValues,
} from '@/lib/exportPanelOps';

/** a panel kezdő chip-értékei (useExportSettings alapértékei) */
const DEFAULTS: ExportChipValues = {
  resolution: 1080,
  fps: 30,
  quality: 'medium',
  codec: 'h264',
  bitrateMode: 'crf',
  bitrateMbps: 10,
  gop: 0,
  bitDepth: 8,
  colorMode: 'rec709',
  sampleRate: 48000,
  channels: 2,
};

describe('export-opciók (kirögzítve)', () => {
  it('a felbontások, fps-ek, minőségek és kodekek sorrendje és címkéje', () => {
    expect(RESOLUTIONS.map((r) => `${r.label}=${r.value}`)).toEqual([
      '480p=480',
      '720p=720',
      '1080p=1080',
      '4K=2160',
      '8K=4320',
    ]);
    expect([...FPS_OPTIONS]).toEqual([24, 30, 60]);
    expect(QUALITIES.map((q) => q.id)).toEqual(['low', 'medium', 'high']);
    expect(CODECS.map((c) => `${c.id}:${c.label}`)).toEqual(['h264:H.264', 'hevc:HEVC', 'av1:AV1', 'prores:ProRes']);
  });

  it('a bitráta-táblák', () => {
    expect(BASE_MBPS).toEqual({ 480: 2.2, 720: 4.5, 1080: 8, 2160: 28, 4320: 90 });
    expect(QUALITY_MULT).toEqual({ low: 0.55, medium: 1, high: 1.5 });
  });
});

describe('méret-becslés', () => {
  it('crf: 1080p közepes 30 fps = 8 Mbps → 60 s ≈ 60 MB', () => {
    expect(estimateExportMb(60, DEFAULTS)).toBeCloseTo(60, 10);
  });

  it('crf: a minőség és az fps is szoroz (4K magas 60 fps)', () => {
    expect(estimateExportMb(10, { ...DEFAULTS, resolution: 2160, quality: 'high', fps: 60 })).toBeCloseTo(
      (28 * 1.5 * (0.35 + 0.65 * 2) * 10) / 8,
      10
    );
    expect(estimateExportMb(8, { ...DEFAULTS, quality: 'low', fps: 24 })).toBeCloseTo(8 * 0.55 * (0.35 + 0.65 * 0.8), 10);
  });

  it('crf: ismeretlen felbontásnál 8 Mbps az alap', () => {
    expect(estimateExportMb(8, { ...DEFAULTS, resolution: 999 })).toBeCloseTo(8, 10);
  });

  it('vbr/cbr: a cél-bitráta számít, a felbontás/minőség/fps nem', () => {
    expect(estimateExportMb(10, { ...DEFAULTS, bitrateMode: 'vbr', bitrateMbps: 16, resolution: 4320, fps: 60 })).toBe(20);
    expect(estimateExportMb(4, { ...DEFAULTS, bitrateMode: 'cbr', bitrateMbps: 6 })).toBe(3);
  });

  it('üres projekt → 0 MB', () => {
    expect(estimateExportMb(0, DEFAULTS)).toBe(0);
  });
});

describe('chipek → RenderSettings', () => {
  it('alapértékek: crf, auto GOP, 8 bit Rec.709 SDR, 192 kbps hang', () => {
    expect(buildRenderSettings(DEFAULTS)).toEqual({
      resolution: 1080,
      fps: 30,
      quality: 'medium',
      codec: 'h264',
      bitrateMode: 'crf',
      bitrateMbps: undefined,
      gop: undefined,
      bitDepth: 8,
      colorSpace: 'rec709',
      hdr: false,
      sampleRate: 48000,
      channels: 2,
      audioBitrateKbps: 192,
    });
  });

  it('vbr/cbr-nél átmegy a cél-bitráta, a pozitív GOP is', () => {
    const s = buildRenderSettings({ ...DEFAULTS, bitrateMode: 'cbr', bitrateMbps: 24, gop: 60 });
    expect(s.bitrateMode).toBe('cbr');
    expect(s.bitrateMbps).toBe(24);
    expect(s.gop).toBe(60);
  });

  it('HDR → 10 bit + hdr, a szín-tér Rec.709 marad (a HDR külön jelző)', () => {
    const s = buildRenderSettings({ ...DEFAULTS, colorMode: 'hdr', bitDepth: 8 });
    expect(s.bitDepth).toBe(10);
    expect(s.hdr).toBe(true);
    expect(s.colorSpace).toBe('rec709');
  });

  it('Rec.2020 → rec2020, nem HDR, a választott mélység marad', () => {
    const s = buildRenderSettings({ ...DEFAULTS, colorMode: 'rec2020', bitDepth: 10 });
    expect(s.colorSpace).toBe('rec2020');
    expect(s.hdr).toBe(false);
    expect(s.bitDepth).toBe(10);
  });

  it('a hang és a kodek változatlanul átmegy', () => {
    const s = buildRenderSettings({ ...DEFAULTS, codec: 'prores', sampleRate: 44100, channels: 1 });
    expect([s.codec, s.sampleRate, s.channels]).toEqual(['prores', 44100, 1]);
  });
});

describe('batch-kijelölés váltása', () => {
  it('ki-be kapcsol, és új halmazt ad (a régi érintetlen)', () => {
    const prev: ReadonlySet<string> = new Set(['tiktok']);
    const added = toggleBatchPlatform(prev, 'youtube');
    expect([...added]).toEqual(['tiktok', 'youtube']);
    expect([...prev]).toEqual(['tiktok']);
    const removed = toggleBatchPlatform(added, 'tiktok');
    expect([...removed]).toEqual(['youtube']);
    expect(removed).not.toBe(added);
  });
});
