import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MasterMeter, LoudnessReadout } from '@/components/studio/audio/LaneMeter';
import { TBtn } from '@/components/studio/audio/TransportButton';
import { palette } from '@/constants/editor';
import { useShuttleHold } from '@/hooks/useShuttleHold';
import { nextSnapMode } from '@/lib/audioStudioOps';
import type { TransportGroup } from '@/lib/audioStudioModes';
import { barsBeatsLabelT, DEFAULT_BPM, meterLabel, nextBeatSecT, prevBeatSecT, tempoMapStep, type Meter, type SnapMode } from '@/lib/audioTransport';
import type { MusicTiming } from '@/lib/musicTime';
import { formatTime } from '@/lib/time';
import { useAudioEditMode, type AudioEditMode } from '@/store/audioEditModeStore';
import { useEditorStore } from '@/store/editorStore';
import { useRecordPrefs } from '@/store/recordPrefsStore';

/** a „zene” csoport hangszer-lapjai */
export type TransportInstrument = 'pianoRoll' | 'drums' | 'sampler' | 'loops' | 'chords';

/**
 * 🎛️ A transzport — gazdag sor (undo/redo · ugrás · loop/In-Out · idő+ütem · BPM · zoom · snap). V10: a csoportok
 * sorrendjét a stúdió-mód dönti el (`audioStudioModes`): az elöl állók látszanak, a többi a „Több” mögött.
 */
export function AudioTransportBar({
  playhead,
  duration,
  timing,
  isPlaying,
  meter,
  bpmHere,
  hasTempoHere,
  front,
  more,
  showMore,
  onToggleMore,
  instruments,
  onOpenInstrument,
  rangeIn,
  rangeOut,
  onTempoAdd,
  onTempoRemove,
  onNextMeter,
  bpmBusy,
  onAutoBpm,
  onZoomStep,
  fitActive,
  onFit,
  onMarker,
  editMode,
  largeLanes,
  assistantOpen,
  onToggleAssistant,
  snapMode,
  onSnapMode,
  onLayout,
}: {
  playhead: number;
  duration: number;
  timing: MusicTiming;
  isPlaying: boolean;
  meter: Meter;
  /** a lejátszófejnél érvényes tempó */
  bpmHere: number;
  /** van-e tempóváltás a lejátszófejnél */
  hasTempoHere: boolean;
  front: TransportGroup[];
  more: TransportGroup[];
  showMore: boolean;
  onToggleMore: () => void;
  instruments: Record<TransportInstrument, boolean>;
  onOpenInstrument: (which: TransportInstrument) => void;
  rangeIn: number | null;
  rangeOut: number | null;
  onTempoAdd: () => void;
  onTempoRemove: () => void;
  onNextMeter: () => void;
  bpmBusy: boolean;
  onAutoBpm: () => void;
  onZoomStep: (dir: 1 | -1) => void;
  fitActive: boolean;
  onFit: () => void;
  onMarker: () => void;
  editMode: AudioEditMode;
  largeLanes: boolean;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  snapMode: SnapMode;
  onSnapMode: (mode: SnapMode) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const { t } = useTranslation();
  const fxBypass = useEditorStore((s) => s.fxBypass);
  const loop = useEditorStore((s) => s.loop);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const metronomeOn = useRecordPrefs((s) => s.metronome);
  const holdBack = useShuttleHold(-1);
  const holdForward = useShuttleHold(1);
  // 🎼 a ± a lejátszófejnél érvényes szakaszt lépteti (az induló tempót SET_BPM-mel)
  const stepTempo = (dir: 1 | -1) => {
    const st = useEditorStore.getState();
    if (!st.project) return;
    const stepped = tempoMapStep(st.project, st.playhead, dir);
    if (stepped) st.dispatch({ type: 'SET_TEMPO_MAP', tempoMap: stepped }, 'user');
    else st.dispatch({ type: 'SET_BPM', bpm: (st.project.bpm ?? DEFAULT_BPM) + dir }, 'user');
  };

  // 🎛️ V10: a transzport-sor csoportjai (a mód dönti el, melyik áll elöl — `audioStudioModes`)
  const transportGroups: Record<TransportGroup, ReactNode> = {
    instruments: (
      <>
        <TBtn icon="musical-notes-outline" label={t('studio.pianoRoll.title')} active={instruments.pianoRoll} onPress={() => onOpenInstrument('pianoRoll')} testID="music-pianoroll" />
        <TBtn icon="grid-outline" label={t('studio.drums.title')} active={instruments.drums} onPress={() => onOpenInstrument('drums')} testID="music-drums" />
        <TBtn icon="color-filter-outline" label={t('studio.sampler.title')} active={instruments.sampler} onPress={() => onOpenInstrument('sampler')} testID="music-sampler" />
        <TBtn icon="repeat-outline" label={t('studio.audio.loops.title')} active={instruments.loops} onPress={() => onOpenInstrument('loops')} testID="music-loops" />
        <TBtn icon="layers-outline" label={t('studio.audio.chords.open')} active={instruments.chords} onPress={() => onOpenInstrument('chords')} testID="music-chords" />
      </>
    ),
    loop: (
      <>
        <TBtn icon="repeat" active={loop} onPress={() => useEditorStore.getState().setLoop(!loop)} accessibilityLabel={loop ? t('editor.transportBar.loopOff') : t('editor.transportBar.loopOn')} />
      </>
    ),
    metronome: (
      <>
        {/* ⏱️ metronóm: lejátszás és felvétel közben (az exportba nem kerül) */}
        <TBtn
          icon="timer-outline"
          testID="audio-metronome"
          active={metronomeOn}
          onPress={() => useRecordPrefs.getState().setMetronome(!metronomeOn)}
          accessibilityLabel={t('studio.audio.transport.metronome')}
        />
      </>
    ),
    range: (
      <>
        <TBtn label={t('studio.audio.transport.rangeIn')} onPress={() => useEditorStore.getState().setRangeIn()} />
        <TBtn label={t('studio.audio.transport.rangeOut')} onPress={() => useEditorStore.getState().setRangeOut()} />
        {rangeIn != null || rangeOut != null ? (
          <TBtn icon="close" onPress={() => useEditorStore.getState().clearRange()} accessibilityLabel={t('studio.audio.a11y.clearRange')} />
        ) : null}
      </>
    ),
    tempo: (
      <>
        {/* BPM léptető + auto-felismerés (a kiválasztott/első hang-klipből) */}
        <TBtn icon="remove" onPress={() => stepTempo(-1)} accessibilityLabel={t('studio.audio.a11y.bpmDown')} />
        <View style={styles.bpmWrap}>
          <Text style={styles.bpmVal}>{bpmHere}</Text>
          <Text style={styles.bpmLabel}>BPM</Text>
        </View>
        <TBtn icon="add" onPress={() => stepTempo(1)} accessibilityLabel={t('studio.audio.a11y.bpmUp')} />
        {/* 🎼 S13: tempóváltás a lejátszófejnél (a legközelebbi egész beaten, az itt kijelzett BPM-mel); hosszan: törlés */}
        <TBtn
          icon="speedometer-outline"
          label={t('studio.audio.transport.tempo')}
          active={hasTempoHere}
          testID="audio-tempo"
          onPress={onTempoAdd}
          onLongPress={onTempoRemove}
          accessibilityLabel={t('studio.audio.a11y.tempoAdd')}
        />
        {/* 🎼 ütemjelzés: koppintásra a következő (4/4 → 3/4 → 2/4 → 6/8 → 5/4 → 7/8 → 12/8) */}
        <TBtn label={meterLabel(meter)} onPress={onNextMeter} />
        <TBtn
          icon={bpmBusy ? undefined : 'sparkles-outline'}
          label={bpmBusy ? '…' : t('studio.audio.transport.auto')}
          active={bpmBusy}
          onPress={onAutoBpm}
        />
      </>
    ),
    zoom: (
      <>
        <TBtn icon="remove-circle-outline" onPress={() => onZoomStep(-1)} accessibilityLabel={t('studio.audio.a11y.zoomOut')} />
        <TBtn icon="add-circle-outline" onPress={() => onZoomStep(1)} accessibilityLabel={t('studio.audio.a11y.zoomIn')} />
        <TBtn icon="contract-outline" label={t('studio.audio.transport.fit')} active={fitActive} onPress={onFit} />
      </>
    ),
    markers: (
      <>
        <TBtn icon="bookmark-outline" label={t('studio.audio.markers.add')} onPress={onMarker} />
      </>
    ),
    editModes: (
      <>
        {/* ✋✂️↔️ érintéses szerkesztési mód + nagy sávok (nagyobb hullámforma) */}
        <TBtn icon="hand-left-outline" active={editMode === 'select'} onPress={() => useAudioEditMode.getState().setMode('select')} accessibilityLabel={t('studio.audio.mode.select')} />
        <TBtn icon="cut-outline" active={editMode === 'cut'} onPress={() => useAudioEditMode.getState().setMode('cut')} accessibilityLabel={t('studio.audio.mode.cut')} />
        <TBtn icon="move-outline" active={editMode === 'move'} onPress={() => useAudioEditMode.getState().setMode('move')} accessibilityLabel={t('studio.audio.mode.move')} />
        <TBtn icon={largeLanes ? 'contract' : 'expand'} active={largeLanes} onPress={() => useAudioEditMode.getState().toggleLarge()} accessibilityLabel={t('studio.audio.mode.large')} />
      </>
    ),
    assistant: (
      <>
        {/* 🎙️🤖 hang-asszisztens (a telefonon, offline) */}
        <TBtn icon="sparkles-outline" label={t('studio.audio.assistant.button')} active={assistantOpen} onPress={onToggleAssistant} />
      </>
    ),
    ab: (
      <>
        {/* 🅰️🅱️ A/B: az eredeti (feldolgozás nélkül) ↔ a feldolgozott — csak az előnézetben */}
        <TBtn icon="git-compare-outline" label={fxBypass ? t('studio.audio.transport.abOriginal') : t('studio.audio.transport.ab')} active={fxBypass} onPress={() => useEditorStore.getState().setFxBypass(!fxBypass)} />
      </>
    ),
    snap: (
      <>
        <TBtn
          label={t(`studio.audio.transport.snap_${snapMode}`)}
          icon="magnet-outline"
          active={snapMode !== 'off'}
          onPress={() => onSnapMode(nextSnapMode(snapMode))}
        />
      </>
    ),
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.transportBar}
      onLayout={onLayout}
      contentContainerStyle={styles.transport}
      keyboardShouldPersistTaps="handled"
    >
      <TBtn icon="arrow-undo" onPress={() => useEditorStore.getState().undo()} disabled={!canUndo} accessibilityLabel={t('editor.transportBar.undo')} />
      <TBtn icon="arrow-redo" onPress={() => useEditorStore.getState().redo()} disabled={!canRedo} accessibilityLabel={t('editor.transportBar.redo')} />
      <View style={styles.tSep} />
      {/* ugrás elejére / lépés beatre vissza */}
      <TBtn icon="play-skip-back" onPress={() => useEditorStore.getState().setPlayhead(0)} accessibilityLabel={t('studio.audio.a11y.toStart')} />
      <TBtn icon="chevron-back" {...holdBack} onPress={() => useEditorStore.getState().setPlayhead(prevBeatSecT(timing, playhead))} accessibilityLabel={t('studio.audio.a11y.prevBeat')} />
      <Pressable onPress={() => useEditorStore.getState().setPlaying(!isPlaying)} style={styles.playBtn} accessibilityRole="button" accessibilityLabel={isPlaying ? t('studio.audio.transport.pause') : t('studio.audio.transport.play')}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
      </Pressable>
      <TBtn icon="chevron-forward" {...holdForward} onPress={() => useEditorStore.getState().setPlayhead(nextBeatSecT(timing, playhead))} accessibilityLabel={t('studio.audio.a11y.nextBeat')} />
      <TBtn icon="play-skip-forward" onPress={() => useEditorStore.getState().setPlayhead(duration)} accessibilityLabel={t('studio.audio.a11y.toEnd')} />
      <View style={styles.tSep} />
      {/* idő + ütem:beat */}
      <View style={styles.timeWrap}>
        <Text style={styles.time}>
          {formatTime(playhead)} / {formatTime(duration)}
        </Text>
        <Text style={styles.bars}>♪ {barsBeatsLabelT(timing, playhead)}</Text>
        <MasterMeter />
        <LoudnessReadout />
      </View>
      <View style={styles.tSep} />
      {front.map((g) => (
        <View key={g} style={styles.tGroup}>
          {transportGroups[g]}
          <View style={styles.tSep} />
        </View>
      ))}
      <TBtn
        testID="audio-transport-more"
        icon={showMore ? 'chevron-back-circle-outline' : 'ellipsis-horizontal-circle-outline'}
        label={showMore ? t('studio.audio.studioMode.less') : t('studio.audio.studioMode.more')}
        active={showMore}
        onPress={onToggleMore}
      />
      {showMore
        ? more.map((g) => (
            <View key={g} style={styles.tGroup}>
              <View style={styles.tSep} />
              {transportGroups[g]}
            </View>
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // a transport-sor nem nő flexből (a sávok kapják a helyet)
  transportBar: { flexGrow: 0 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  time: { color: palette.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  timeWrap: { alignItems: 'center' },
  bars: { color: palette.accent, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tSep: { width: 1, height: 24, backgroundColor: palette.border, marginHorizontal: 2 },
  bpmWrap: { alignItems: 'center', minWidth: 34 },
  bpmVal: { color: palette.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bpmLabel: { color: palette.textDim, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
});
