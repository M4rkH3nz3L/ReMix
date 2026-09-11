import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { getWaveform, resamplePeaks } from '@/lib/waveform';
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
}

/**
 * Hullámforma a hangklipek hátterében. A csúcsokat a worker számolja
 * (lemez-cache-elve); worker nélkül a komponens csendben üres marad.
 */
export function ClipWaveform({ clip, widthPx, heightPx, color }: Props) {
  const [wave, setWave] = useState<WaveformData | null>(null);

  useEffect(() => {
    let active = true;
    getWaveform(clip.uri).then((data) => {
      if (active) {
        setWave(data);
      }
    });
    return () => {
      active = false;
    };
  }, [clip.uri]);

  if (!wave) {
    return null;
  }

  const columns = clamp(Math.floor(widthPx / 3), 8, 200);
  // a hangklip mindig a forrás elejétől szól — az első `duration` mp látszik
  const visible = wave.peaks.slice(
    0,
    Math.max(1, Math.floor(clip.duration * wave.peaksPerSecond))
  );
  const bars = resamplePeaks(visible, columns);
  // megjelenítés-normalizálás: az egyenletes hangerejű (pl. steady zene) jel
  // hulláma is látsszon — a dinamika-tartomány a teljes magasságra nyílik
  const mx = Math.max(...bars);
  const mn = Math.min(...bars);
  const norm = bars.map((p) =>
    mx - mn > 0.02 ? 0.3 + 0.7 * ((p - mn) / (mx - mn)) : 0.6
  );
  // ⚠️ clipping: a NYERS (full-scale) csúcs 0 dBFS közelében — torzulhat a hang
  const clipping = bars.map((p) => p >= CLIP_THRESHOLD);
  // a hullám a klip TELJES magasságát használja — markáns, telt megjelenés
  const maxBar = heightPx - 4;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      {norm.map((p, i) => (
        <View
          key={i}
          style={{
            width: 2.5,
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
