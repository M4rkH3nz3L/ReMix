import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { mixForExport } from '@/lib/audioExportMix';
import { CLIP_LEVEL, levelDb, meterFill, trackLevelAt } from '@/lib/levelMeter';
import { offlineMixPlan } from '@/lib/offlineMix';
import { getWaveform, type WaveformData } from '@/lib/waveform';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

const CLIP_HOLD_SEC = 2;

/**
 * 📶 Sávonkénti élő szintmérő (PRO-AUDIO 17/8): a lejátszófejnél mért csúcsszint a
 * hullámforma-csúcsokból × az export erősítéseivel (`trackLevelAt`). −6 dB fölött sárga,
 * túlvezérlésnél piros, és a piros 2 mp-ig megmarad (a pillanatnyi túllépés is látszik).
 */
export function LaneMeter({ type }: { type: TrackType }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const muted = useEditorStore((s) => s.mutedTracks);
  const solo = useEditorStore((s) => s.soloTracks);

  // a keverési terv: ugyanaz, mint az exportban (némítás, solo, master)
  const clips = useMemo(() => {
    if (!project) {
      return [];
    }
    const audible = (t: TrackType) => (solo.length > 0 ? solo.includes(t) : !muted.includes(t));
    const mix = mixForExport(project, audible, masterVolume);
    return mix ? offlineMixPlan(mix).clips.filter((c) => c.track === type) : [];
  }, [project, masterVolume, muted, solo, type]);

  const [waves, setWaves] = useState<Map<string, WaveformData>>(new Map());
  const uris = useMemo(() => [...new Set(clips.map((c) => c.uri))].sort().join('|'), [clips]);
  useEffect(() => {
    let alive = true;
    for (const uri of uris ? uris.split('|') : []) {
      getWaveform(uri, { userInitiated: true })
        .then((w) => {
          if (alive && w) {
            setWaves((m) => (m.get(uri) === w ? m : new Map(m).set(uri, w)));
          }
        })
        .catch((caught) => { logCaught('components/studio/audio/LaneMeter.tsx:waveform', caught); });
    }
    return () => {
      alive = false;
    };
  }, [uris]);

  const level = trackLevelAt(clips, (uri) => waves.get(uri), playhead);
  // a piros a lejátszófej idejében tart ki (a túllépés után 2 mp-ig), szünetben is
  const clipAt = useRef<number | null>(null);
  if (level >= CLIP_LEVEL) {
    clipAt.current = playhead;
  }
  const clipping = clipAt.current !== null && playhead >= clipAt.current && playhead - clipAt.current < CLIP_HOLD_SEC;
  const db = levelDb(level);

  return (
    <View
      style={styles.track}
      testID={`lane-meter-${type}`}
      accessibilityLabel={`${Math.round(db)} dB${clipping ? ' — túlvezérlés' : ''}`}
    >
      <View
        testID={`lane-meter-fill-${type}`}
        style={[
          styles.fill,
          { width: `${Math.round(meterFill(level) * 100)}%`, backgroundColor: clipping ? palette.danger : db > -6 ? '#f5c542' : '#39d98a' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: 44, height: 4, borderRadius: 2, backgroundColor: `${palette.border}`, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
