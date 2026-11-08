import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { mixForExport } from '@/lib/audioExportMix';
import { CLIP_LEVEL, clipRanges, levelDb, meterFill, trackLevelAt } from '@/lib/levelMeter';
import { offlineMixPlan, type OfflineMixClip } from '@/lib/offlineMix';
import { getWaveform, type WaveformData } from '@/lib/waveform';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import type { LoudnessReading } from '@/lib/liveLoudness';
import { previewEngine } from '@/lib/previewEngine';

const CLIP_HOLD_SEC = 2;

/**
 * 📶 Sávonkénti élő szintmérő (PRO-AUDIO 17/8): a lejátszófejnél mért csúcsszint a
 * hullámforma-csúcsokból × az export erősítéseivel (`trackLevelAt`). −6 dB fölött sárga,
 * túlvezérlésnél piros, és a piros 2 mp-ig megmarad (a pillanatnyi túllépés is látszik).
 */
/** A keverési terv (ugyanaz, mint az exportban: némítás, solo, master) + a forrás-hullámformák. */
function useMixMeterData(): { clips: OfflineMixClip[]; waveOf: (uri: string) => WaveformData | undefined; duration: number } {
  const project = useEditorStore((s) => s.project);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const muted = useEditorStore((s) => s.mutedTracks);
  const solo = useEditorStore((s) => s.soloTracks);
  const { clips, duration } = useMemo(() => {
    if (!project) {
      return { clips: [] as OfflineMixClip[], duration: 0 };
    }
    const audible = (t: TrackType) => (solo.length > 0 ? solo.includes(t) : !muted.includes(t));
    const mix = mixForExport(project, audible, masterVolume);
    const plan = mix ? offlineMixPlan(mix) : null;
    return { clips: plan?.clips ?? [], duration: plan?.duration ?? 0 };
  }, [project, masterVolume, muted, solo]);

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
  const waveOf = useCallback((uri: string) => waves.get(uri), [waves]);
  return { clips, waveOf, duration };
}

export function LaneMeter({ type }: { type: TrackType }) {
  const playhead = useEditorStore((s) => s.playhead);
  const { clips, waveOf } = useMixMeterData();
  const level = trackLevelAt(clips.filter((c) => c.track === type), waveOf, playhead);
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
  lufs: { color: palette.textDim, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  track: { width: 44, height: 4, borderRadius: 2, backgroundColor: `${palette.border}`, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  master: { width: 56, height: 6, borderRadius: 3, backgroundColor: `${palette.border}`, overflow: 'hidden', alignSelf: 'center' },
  masterFill: { height: 6, borderRadius: 3 },
  marker: { position: 'absolute', bottom: 0, height: 3, backgroundColor: palette.danger },
});

/** 📶 Master-mérő: a teljes mix szintje a lejátszófejnél (a sávok összege — felső becslés). */
export function MasterMeter() {
  const playhead = useEditorStore((s) => s.playhead);
  const { clips, waveOf } = useMixMeterData();
  const level = trackLevelAt(clips, waveOf, playhead);
  const clipping = level >= CLIP_LEVEL;
  const db = levelDb(level);
  return (
    <View style={styles.master} testID="master-meter" accessibilityLabel={`Master ${Math.round(db)} dB${clipping ? ' — túlvezérlés' : ''}`}>
      <View
        testID="master-meter-fill"
        style={[styles.masterFill, { width: `${Math.round(meterFill(level) * 100)}%`, backgroundColor: clipping ? palette.danger : db > -6 ? '#f5c542' : '#39d98a' }]}
      />
    </View>
  );
}

/** 🔴 A vonalzó alján: a túlvezérelt szakaszok a teljes projekten (lejátszás nélkül is látszik). */
export function ClipMarkers({ pxPerSec }: { pxPerSec: number }) {
  const { clips, waveOf, duration } = useMixMeterData();
  const ranges = useMemo(() => clipRanges(clips, waveOf, duration), [clips, waveOf, duration]);
  return (
    <>
      {ranges.map((r) => (
        <View
          key={`clip${r.start}`}
          testID="clip-marker"
          pointerEvents="none"
          style={[styles.marker, { left: r.start * pxPerSec, width: Math.max(2, (r.end - r.start) * pxPerSec) }]}
        />
      ))}
    </>
  );
}

/**
 * 📊 Élő hangosság a masteren (lejátszás közben): short-term LUFS és true-peak a ténylegesen szóló,
 * az exporttal azonos keverésből (az előnézet-motor méri). A true-peak a master plafonja fölött piros.
 */
export function LoudnessReadout() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const ceiling = useEditorStore((s) => s.project?.audioMaster?.truePeak ?? -1);
  const [r, setR] = useState<LoudnessReading | null>(null);
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => setR(previewEngine.loudness()), 200);
    return () => clearInterval(id);
  }, [isPlaying]);
  const reading = isPlaying ? r : null;
  const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const over = !!reading && Number.isFinite(reading.truePeak) && reading.truePeak > ceiling;
  return (
    <Text style={[styles.lufs, over && { color: palette.danger }]} testID="loudness-readout" numberOfLines={1} maxFontSizeMultiplier={1.3}>
      {reading ? `S ${fmt(reading.shortTerm)} LUFS · TP ${fmt(reading.truePeak)}` : 'LUFS —'}
    </Text>
  );
}
