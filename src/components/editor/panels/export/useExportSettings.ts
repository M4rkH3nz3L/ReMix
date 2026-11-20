import { useState } from 'react';

import type {
  ExportBitrateMode,
  ExportChipValues,
  ExportCodec,
  ExportColorMode,
  ExportQuality,
} from '@/lib/exportPanelOps';
import { PLATFORM_PRESETS } from '@/lib/render';
import type { ExportPlatform, RenderMode } from '@/lib/render';

/**
 * Az export-beállítás chipjeinek állapota (felbontás → csatorna), a panel eredeti
 * useState-sorrendjében; plusz a platform-preset alkalmazása.
 */
export function useExportSettings() {
  const [resolution, setResolution] = useState<number>(1080);
  const [fps, setFps] = useState<number>(30);
  const [quality, setQuality] = useState<ExportQuality>('medium');
  const [codec, setCodec] = useState<ExportCodec>('h264');
  // ⚙️ Pro: render-motor választás (eszköz/felhő) — a posztolás/feed-megosztás
  // is ezt használja ('auto' = eszköz, ha tudja; különben felhő)
  const [engine, setEngine] = useState<RenderMode>('auto');
  const [platform, setPlatform] = useState<ExportPlatform | null>(null);
  // 📦 batch-export: több platform egyszerre (deduplikált jobok → sorban renderelve)
  const [batchSet, setBatchSet] = useState<ReadonlySet<ExportPlatform>>(new Set());
  // 🎚️ Pro export-kontroll (Advanced): bitráta / GOP / bit-mélység / szín / audio
  const [advOpen, setAdvOpen] = useState(false);
  const [bitrateMode, setBitrateMode] = useState<ExportBitrateMode>('crf');
  const [bitrateMbps, setBitrateMbps] = useState<number>(10);
  const [gop, setGop] = useState<number>(0); // 0 = auto (fps × 2)
  const [bitDepth, setBitDepth] = useState<8 | 10>(8);
  const [colorMode, setColorMode] = useState<ExportColorMode>('rec709');
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(48000);
  const [channels, setChannels] = useState<1 | 2>(2);

  // 📲 platform-preset alkalmazása a chipekre (a felhasználó utána felülírhatja)
  const applyPlatform = (p: ExportPlatform) => {
    setPlatform(p);
    const s = PLATFORM_PRESETS[p].settings;
    if (s.resolution) setResolution(s.resolution);
    if (s.fps) setFps(s.fps);
    if (s.quality) setQuality(s.quality);
    if (s.codec) setCodec(s.codec);
    if (s.bitrateMode) setBitrateMode(s.bitrateMode);
    if (s.bitrateMbps) setBitrateMbps(s.bitrateMbps);
  };

  const values: ExportChipValues = {
    resolution,
    fps,
    quality,
    codec,
    bitrateMode,
    bitrateMbps,
    gop,
    bitDepth,
    colorMode,
    sampleRate,
    channels,
  };

  return {
    values,
    setResolution,
    setFps,
    setQuality,
    setCodec,
    engine,
    setEngine,
    platform,
    batchSet,
    setBatchSet,
    advOpen,
    setAdvOpen,
    setBitrateMode,
    setBitrateMbps,
    setGop,
    setBitDepth,
    setColorMode,
    setSampleRate,
    setChannels,
    applyPlatform,
  };
}

export type ExportSettingsState = ReturnType<typeof useExportSettings>;
