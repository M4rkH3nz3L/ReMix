import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { RegionBar, Slider, type useWaveform } from '@/components/studio/audio/primitives';
import { CLIP_DB_MAX, CLIP_DB_MIN, dbToVolume, formatDb, volumeToDb } from '@/lib/clipGain';

type NumSetter = Dispatch<SetStateAction<number>>;

/** ✂️🔊 a szakasz (trim + hullámforma), a klip-erősítés, a pásztázás és a fade-ek — a lap helyi állapotán */
export function ClipLevelSection({
  trimIn,
  duration,
  sourceDuration,
  fadeIn,
  fadeOut,
  volume,
  pan,
  maxFade,
  clipPlayhead,
  wave,
  setTrimIn,
  setDuration,
  setFadeIn,
  setFadeOut,
  setVolume,
  setPan,
}: {
  trimIn: number;
  duration: number;
  sourceDuration: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  pan: number;
  maxFade: number;
  clipPlayhead: number;
  wave: ReturnType<typeof useWaveform>;
  setTrimIn: NumSetter;
  setDuration: NumSetter;
  setFadeIn: NumSetter;
  setFadeOut: NumSetter;
  setVolume: NumSetter;
  setPan: NumSetter;
}) {
  const { t } = useTranslation();
  return (
    <>
      <RegionBar
        trimIn={trimIn}
        duration={duration}
        sourceDuration={sourceDuration}
        fadeIn={fadeIn}
        fadeOut={fadeOut}
        playhead={clipPlayhead}
        peaks={wave?.peaks ?? null}
        waveDuration={wave?.duration ?? sourceDuration}
        onChange={({ trimIn: ti, duration: d }) => {
          setTrimIn(ti);
          setDuration(d);
          setFadeIn((v) => Math.min(v, d / 2));
          setFadeOut((v) => Math.min(v, d / 2));
        }}
      />

      {/* 🔊 klip-erősítés dB-ben: −∞ … +12 dB (0 dB-nél megáll) — a keverő a 0 dB fölötti erősítést is alkalmazza */}
      <Slider
        label={t('studio.audio.volume')}
        value={volumeToDb(volume)}
        min={CLIP_DB_MIN}
        max={CLIP_DB_MAX}
        onChange={(db) => setVolume(dbToVolume(db))}
        format={(db) => formatDb(dbToVolume(db))}
      />
      <Slider
        label={t('studio.audio.pan')}
        value={pan}
        min={-1}
        max={1}
        onChange={setPan}
        format={(v) =>
          v === 0 ? t('studio.audio.panCenter') : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`
        }
      />
      <Slider
        label={t('studio.audio.fadeIn')}
        value={fadeIn}
        min={0}
        max={maxFade}
        onChange={setFadeIn}
        format={(v) => `${v.toFixed(1)}s`}
      />
      <Slider
        label={t('studio.audio.fadeOut')}
        value={fadeOut}
        min={0}
        max={maxFade}
        onChange={setFadeOut}
        format={(v) => `${v.toFixed(1)}s`}
      />
    </>
  );
}
