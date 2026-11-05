import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { audioSpeedOf } from '@/lib/audioTrim';
import { barHeights, clipWindowPeaks, getWaveform, resamplePeaks } from '@/lib/waveform';
import type { WaveformData } from '@/lib/waveform';
import { clamp } from '@/lib/time';
import type { AudioClip } from '@/types/project';

/** full-scale (0 dBFS) közeli csúcs = torzulás/clipping — a csúcsok abszolút [0,1] értékek */
const CLIP_THRESHOLD = 0.99;

interface Props {
  clip: AudioClip;
  widthPx: number;
  heightPx: number;
  color: string;
  /** a Hang Stúdióban a megjelenítés a felhasználó kérése (iOS-en nem háttér-hívás, A20) */
  userInitiated?: boolean;
}

/**
 * Hullámforma a hangklipek hátterében: a klip VÁGOTT szakasza, abszolút szinttel. A csúcsokat
 * az eszköz számolja (lemez-cache-elve); ha a dekódolás nem megy, a komponens üres marad.
 */
export function ClipWaveform({ clip, widthPx, heightPx, color, userInitiated = false }: Props) {
  const [wave, setWave] = useState<WaveformData | null>(null);

  useEffect(() => {
    let active = true;
    getWaveform(clip.uri, { userInitiated }).then((data) => {
      if (active) {
        setWave(data);
      }
    });
    return () => {
      active = false;
    };
  }, [clip.uri, userInitiated]);

  if (!wave) {
    return null;
  }

  // A22: annyi oszlop, amennyi kifér (≥3.5 px), és a sor pontosan kitölti a klipet
  const columns = clamp(Math.floor((widthPx - 8) / 3.5), 1, 400);
  const bars = resamplePeaks(clipWindowPeaks(wave, clip.trimIn, clip.duration * audioSpeedOf(clip)), columns);
  const heights = barHeights(bars);
  // ⚠️ clipping: a NYERS (full-scale) csúcs 0 dBFS közelében — torzulhat a hang
  const clipping = bars.map((p) => p >= CLIP_THRESHOLD);
  // a hullám a klip TELJES magasságát használja — markáns, telt megjelenés
  const maxBar = heightPx - 4;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      {heights.map((p, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            marginRight: 1,
            borderRadius: 1.5,
            height: Math.max(3, p * maxBar),
            // a torzuló (clipping) sávok pirosak — azonnal látszik, hol esik szét a hang
            backgroundColor: clipping[i] ? palette.danger : color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 4,
    right: 4,
    bottom: 0,
    borderRadius: 4.5,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
});
