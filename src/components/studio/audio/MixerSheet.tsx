import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMixAssist } from '@/store/mixAssistStore';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { Slider } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import {
  audioClipIds,
  canDuckTrack,
  formatGainDb,
  MAX_GAIN,
  trackDucked,
} from '@/lib/mixerView';
import { useEditorStore } from '@/store/editorStore';
import type { EditorCommand } from '@/lib/commands';
import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { makeId } from '@/lib/id';
import type { AudioBus, TrackType } from '@/types/project';


/**
 * 🎚️ MIXER — profi keverő-felület (AUDIOT §2): csatornánként **fader (gain)** + **némít/szóló** +
 * **DUCK** (sidechain: a zene/sfx lehalkul a voiceover alatt). A render-oldal MÁR kész a workerben
 * (`trackMix[type].gain` + `clip.autoDuck`→`sidechaincompress`) — ez a felület azt vezérli, a
 * matek a pure `mixerView.ts`-ben. A Master-lánc (EQ/LUFS/limiter) a külön Master-lapon.
 */
export function MixerSheet({ onClose, onOpenMaster }: { onClose: () => void; onOpenMaster: () => void }) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);

  if (!project) {
    return null;
  }
  const LANES = audioLanes(project);
  const buses = project.audioBuses ?? [];

  /** ➕ busz a sablonból (zengés / visszhang) */
  const addBus = (kind: 'reverb' | 'delay') => {
    const bus: AudioBus = {
      id: makeId('bus'),
      name: t(`studio.mixer.bus.${kind}`),
      fx: kind === 'reverb' ? { reverb: 0.6 } : { delay: 0.4 },
      gain: 0.8,
    };
    useEditorStore.getState().dispatch({ type: 'SET_AUDIO_BUSES', buses: [...buses, bus] });
  };
  const patchBus = (id: string, patch: Partial<AudioBus>) =>
    useEditorStore.getState().dispatch({ type: 'SET_AUDIO_BUSES', buses: buses.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const removeBus = (id: string) =>
    useEditorStore.getState().dispatch({ type: 'SET_AUDIO_BUSES', buses: buses.filter((b) => b.id !== id) });

  const setGain = (type: TrackType, gain: number) =>
    useEditorStore.getState().dispatch({ type: 'SET_TRACK_GAIN', trackType: type, gain });

  const toggleDuck = (type: TrackType) => {
    const track = project.tracks.find((tr) => tr.type === type);
    if (!track) {
      return;
    }
    const ids = audioClipIds(track.clips);
    if (ids.length === 0) {
      return;
    }
    const next = !trackDucked(track.clips);
    const cmds: EditorCommand[] = ids.map((id) => ({ type: 'UPDATE_CLIP', clipId: id, patch: { autoDuck: next } }));
    useEditorStore.getState().applyBatch(cmds, 'user');
  };

  return (
    <AudioSheetFrame id="mixer" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="options" size={16} color={palette.accent} /> {t('studio.mixer.title', { defaultValue: 'Mixer' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={palette.textDim} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
        {/* 🎚️🤖 mixjavaslat (mérés a telefonon) */}
        <Pressable style={[styles.chip, styles.chipAccent, { alignSelf: 'flex-start', marginBottom: 10 }]} onPress={() => useMixAssist.getState().show('mix')} testID="mixer-mix-assist">
          <Text style={[styles.chipText, { color: '#fff' }]}>✨ {t('studio.audio.mixAssist.openMix')}</Text>
        </Pressable>
        {LANES.map((lane) => {
          const track = project.tracks.find((tr) => tr.type === lane.type);
          const clipCount = track ? track.clips.filter((c) => c.kind === 'audio').length : 0;
          const gain = project.trackMix?.[lane.type]?.gain ?? 1;
          const muted = mutedTracks.includes(lane.type);
          const solo = soloTracks.includes(lane.type);
          const ducked = track ? trackDucked(track.clips) : false;
          return (
            <View key={lane.type} style={styles.strip}>
              <View style={styles.stripHead}>
                <Ionicons name={lane.icon} size={15} color={lane.color} />
                <Text style={styles.stripName} numberOfLines={1}>
                  {laneLabel(lane, t)}
                </Text>
                <Text style={styles.clipCount}>{clipCount}</Text>
                <Text style={[styles.db, { color: lane.color }]}>{formatGainDb(gain)} dB</Text>
              </View>

              <Slider
                label=""
                value={gain}
                min={0}
                max={MAX_GAIN}
                onChange={(v) => setGain(lane.type, v)}
                format={(v) => `${formatGainDb(v)} dB`}
              />

              {/* 🎚️ küldések a buszokra (a fader után) */}
              {buses.map((b) => (
                <Slider
                  key={b.id}
                  label={`→ ${b.name}`}
                  value={project.audioSends?.[lane.type]?.[b.id] ?? 0}
                  min={0}
                  max={1}
                  onChange={(v) => useEditorStore.getState().dispatch({ type: 'SET_TRACK_SEND', trackType: lane.type, busId: b.id, amount: v })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              ))}

              <View style={styles.btnRow}>
                <Pressable
                  onPress={() => useEditorStore.getState().toggleTrackFlag(lane.type, 'mute')}
                  style={[styles.chip, muted && styles.chipDanger]}
                >
                  <Ionicons name={muted ? 'volume-mute' : 'volume-medium'} size={14} color={muted ? '#fff' : palette.textDim} />
                  <Text style={[styles.chipText, muted && { color: '#fff' }]}>{t('studio.mixer.mute', { defaultValue: 'Némít' })}</Text>
                </Pressable>
                <Pressable
                  onPress={() => useEditorStore.getState().toggleTrackFlag(lane.type, 'solo')}
                  style={[styles.chip, solo && styles.chipAccent]}
                >
                  <Text style={[styles.chipText, solo && { color: '#fff' }]}>S</Text>
                  <Text style={[styles.chipText, solo && { color: '#fff' }]}>{t('studio.mixer.solo', { defaultValue: 'Szóló' })}</Text>
                </Pressable>
                {canDuckTrack(lane.type) ? (
                  <Pressable
                    onPress={() => toggleDuck(lane.type)}
                    disabled={clipCount === 0}
                    style={[styles.chip, ducked && styles.chipAccent, clipCount === 0 && styles.chipDisabled]}
                  >
                    <Ionicons name="volume-low-outline" size={14} color={ducked ? '#fff' : palette.textDim} />
                    <Text style={[styles.chipText, ducked && { color: '#fff' }]}>{t('studio.mixer.duck', { defaultValue: 'Duck' })}</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.chip, styles.chipGhost]}>
                    <Ionicons name="key-outline" size={13} color={palette.textDim} />
                    <Text style={styles.chipText}>{t('studio.mixer.sidechainKey', { defaultValue: 'Kulcs' })}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* 🎚️ effekt-buszok: a sávok küldései ide kevernek, a busz effektje után a master elé */}
        <Text style={styles.section}>{t('studio.mixer.bus.title')}</Text>
        {buses.map((b) => (
          <View key={b.id} style={styles.strip} testID={`mixer-bus-${b.id}`}>
            <View style={styles.stripHead}>
              <Ionicons name="git-merge-outline" size={15} color={palette.accent} />
              <Text style={styles.stripName} numberOfLines={1}>
                {b.name}
              </Text>
              <Pressable onPress={() => removeBus(b.id)} hitSlop={8} style={{ marginLeft: 'auto' }}>
                <Ionicons name="trash-outline" size={16} color={palette.textDim} />
              </Pressable>
            </View>
            <Slider label={t('studio.mixer.bus.return')} value={b.gain} min={0} max={1} onChange={(v) => patchBus(b.id, { gain: v })} format={(v) => `${Math.round(v * 100)}%`} />
            {b.fx.reverb !== undefined ? (
              <Slider label={t('studio.mixer.bus.reverb')} value={b.fx.reverb} min={0.05} max={1} onChange={(v) => patchBus(b.id, { fx: { ...b.fx, reverb: v } })} format={(v) => `${Math.round(v * 100)}%`} />
            ) : null}
            {b.fx.delay !== undefined ? (
              <Slider label={t('studio.mixer.bus.delay')} value={b.fx.delay} min={0.05} max={1} onChange={(v) => patchBus(b.id, { fx: { ...b.fx, delay: v } })} format={(v) => `${Math.round(v * 100)}%`} />
            ) : null}
          </View>
        ))}
        <View style={styles.btnRow}>
          <Pressable style={styles.chip} onPress={() => addBus('reverb')} testID="mixer-add-reverb-bus">
            <Ionicons name="add" size={14} color={palette.textDim} />
            <Text style={styles.chipText}>{t('studio.mixer.bus.reverb')}</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => addBus('delay')} testID="mixer-add-delay-bus">
            <Ionicons name="add" size={14} color={palette.textDim} />
            <Text style={styles.chipText}>{t('studio.mixer.bus.delay')}</Text>
          </Pressable>
        </View>

        {/* Master-szalag → a Master-lánc (EQ/LUFS/limiter) a külön lapon */}
        <Pressable style={styles.masterBtn} onPress={onOpenMaster}>
          <Ionicons name="pulse-outline" size={16} color="#fff" />
          <Text style={styles.masterText}>{t('studio.mixer.openMaster', { defaultValue: 'Master-lánc (EQ · LUFS · limiter)' })}</Text>
        </Pressable>
        <Text style={styles.hint}>
          {t('studio.mixer.duckHint', {
            defaultValue: 'A DUCK: a zene/sfx automatikusan lehalkul, amikor a voiceover szól (sidechain).',
          })}
        </Text>
      </ScrollView>
    </AudioSheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, maxHeight: '86%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  strip: { backgroundColor: '#0d0f16', borderRadius: 12, padding: 12, marginBottom: 10 },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  stripName: { color: palette.text, fontSize: 14, fontWeight: '700' },
  clipCount: { color: palette.textDim, fontSize: 11, fontWeight: '700', backgroundColor: palette.surface, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  db: { marginLeft: 'auto', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  chip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 9, paddingVertical: 8, backgroundColor: palette.surface },
  chipAccent: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipDanger: { backgroundColor: palette.danger, borderColor: palette.danger },
  chipGhost: { opacity: 0.6 },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  masterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.surfaceHigh, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingVertical: 13, marginTop: 4 },
  masterText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  hint: { color: palette.textDim, fontSize: 12, marginTop: 10, lineHeight: 17 },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '800', marginTop: 6, marginBottom: 8, textTransform: 'uppercase' },
});
