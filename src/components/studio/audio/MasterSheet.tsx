import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, PrimaryButton, Stepper } from '@/components/ui/controls';
import { Slider } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import { analyzeAudio, type LoudnessStats } from '@/lib/audioAnalyze';
import { AUDIO_MASTER_TARGETS, masterPreset } from '@/lib/audioMaster';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, AudioMaster, AudioMasterDynamics, TrackType } from '@/types/project';

const MIX_LANES: { type: TrackType; icon: keyof typeof Ionicons.glyphMap; labelKey: string }[] = [
  { type: 'music', icon: 'musical-notes', labelKey: 'editor.track.music' },
  { type: 'voiceover', icon: 'mic', labelKey: 'editor.track.voiceover' },
  { type: 'sfx', icon: 'flash', labelKey: 'editor.track.sfx' },
];

const DYNAMICS: AudioMasterDynamics[] = ['natural', 'balanced', 'punchy'];

/**
 * 🎚️ Mixer + Master lap (AUDIO-MASTER). A Mixer a sáv-monitorozás (mute/solo) +
 * a master-hangerő — ELŐNÉZET-szintű. A Master a projekt-szintű hangosítás/plafon,
 * ami a RENDERBE sül (`project.audioMaster` → SET_AUDIO_MASTER, undo-zható).
 */
export function MasterSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);

  const [m, setM] = useState<AudioMaster>(project?.audioMaster ?? masterPreset('video'));
  const applied = !!project?.audioMaster;
  const [analyzing, setAnalyzing] = useState(false);
  const [stats, setStats] = useState<LoudnessStats | null>(null);
  const [spectrum, setSpectrum] = useState<string | null>(null);

  // az elemzés forrása: a renderelt mix, ha van; egyébként az első hangklip (proxy)
  const analyzeSource = (() => {
    const rendered = project?.rendered?.url || project?.rendered?.uri;
    if (rendered) {
      return rendered;
    }
    for (const type of ['music', 'voiceover', 'sfx'] as const) {
      const clip = project?.tracks
        .find((tr) => tr.type === type)
        ?.clips.find((c): c is AudioClip => c.kind === 'audio');
      if (clip) {
        return clip.uri;
      }
    }
    return null;
  })();

  const onAnalyze = () => {
    if (!analyzeSource || analyzing) {
      return;
    }
    setAnalyzing(true);
    analyzeAudio(analyzeSource)
      .then((r) => {
        setStats(r);
        setSpectrum(r.spectrum ?? null);
      })
      .catch((e: Error) => Alert.alert(t('studio.master.analyze'), e.message))
      .finally(() => setAnalyzing(false));
  };

  const setField = (patch: Partial<AudioMaster>) =>
    setM((prev) => ({ ...prev, ...patch, target: 'custom' }));

  const setEq = (band: 'low' | 'mid' | 'high', delta: number) => {
    const eq = m.eq ?? { low: 0, mid: 0, high: 0 };
    setField({ eq: { ...eq, [band]: clamp(eq[band] + delta, -12, 12) } });
  };

  const apply = () => {
    useEditorStore.getState().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: m }, 'user');
    onClose();
  };
  const turnOff = () => {
    useEditorStore.getState().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: null }, 'user');
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.master.title')}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
            {/* — Mixer — */}
            <Text style={styles.section}>{t('studio.master.mixer')}</Text>
            <Slider
              label={t('studio.master.masterVolume')}
              value={masterVolume}
              min={0}
              max={1}
              onChange={(v) => useEditorStore.getState().setMasterVolume(v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            {MIX_LANES.map((lane) => {
              const muted = mutedTracks.includes(lane.type);
              const solo = soloTracks.includes(lane.type);
              const gain = project?.trackMix?.[lane.type]?.gain ?? 1;
              return (
                <View key={lane.type} style={styles.mixBlock}>
                  <View style={styles.mixRow}>
                    <Ionicons name={lane.icon} size={16} color={palette.accent} />
                    <Text style={styles.mixLabel}>{t(lane.labelKey)}</Text>
                    <Text style={styles.mixGain}>{Math.round(gain * 100)}%</Text>
                    <Pressable
                      onPress={() => useEditorStore.getState().toggleTrackFlag(lane.type, 'mute')}
                      style={[styles.mixBtn, muted && { borderColor: palette.danger }]}
                    >
                      <Ionicons name={muted ? 'volume-mute' : 'volume-medium'} size={15} color={muted ? palette.danger : palette.textDim} />
                    </Pressable>
                    <Pressable
                      onPress={() => useEditorStore.getState().toggleTrackFlag(lane.type, 'solo')}
                      style={[styles.mixBtn, solo && { borderColor: palette.accent }]}
                    >
                      <Text style={[styles.soloText, solo && { color: palette.accent }]}>S</Text>
                    </Pressable>
                  </View>
                  <Slider
                    label=""
                    value={gain}
                    min={0}
                    max={1}
                    onChange={(g) =>
                      useEditorStore.getState().dispatch({ type: 'SET_TRACK_GAIN', trackType: lane.type, gain: g }, 'user')
                    }
                    format={() => ''}
                  />
                </View>
              );
            })}
            <Text style={styles.hint}>{t('studio.master.mixerHint')}</Text>

            {/* — Master — */}
            <View style={styles.divider} />
            <Text style={styles.section}>{t('studio.master.masterChain')}</Text>
            {analyzeSource ? (
              <>
                <Pressable onPress={onAnalyze} disabled={analyzing} style={styles.analyzeRow}>
                  {analyzing ? (
                    <ActivityIndicator color={palette.accent} size="small" />
                  ) : (
                    <Ionicons name="pulse-outline" size={15} color={palette.accent} />
                  )}
                  <Text style={styles.analyzeText}>{t('studio.master.analyze')}</Text>
                </Pressable>
                {stats ? (
                  <View style={styles.meters}>
                    <Meter label="LUFS" value={stats.lufs} target={m.lufs} min={-30} max={0} />
                    <Meter label={t('studio.master.truePeak')} value={stats.truePeak} target={m.truePeak} min={-9} max={1} />
                    <Meter label="LRA" value={stats.lra} min={0} max={20} />
                    {stats.noise != null ? <Meter label={t('studio.master.noise')} value={stats.noise} min={-90} max={-20} /> : null}
                    {stats.dynamicRange != null ? (
                      <Meter label={t('studio.master.dynRange')} value={stats.dynamicRange} min={0} max={60} />
                    ) : null}
                  </View>
                ) : null}
                {spectrum ? (
                  <Image source={{ uri: spectrum }} style={styles.spectrum} contentFit="cover" />
                ) : null}
              </>
            ) : null}
            <View style={styles.chipRow}>
              {AUDIO_MASTER_TARGETS.map((target) => (
                <Chip
                  key={target}
                  label={t(`studio.master.target.${target}`)}
                  active={m.target === target}
                  onPress={() => setM(target === 'custom' ? { ...m, target: 'custom' } : masterPreset(target))}
                />
              ))}
            </View>
            <Stepper
              label={t('studio.master.lufs')}
              value={`${m.lufs} LUFS`}
              onDec={() => setField({ lufs: clamp(m.lufs - 1, -24, -6) })}
              onInc={() => setField({ lufs: clamp(m.lufs + 1, -24, -6) })}
            />
            <Stepper
              label={t('studio.master.truePeak')}
              value={`${m.truePeak} dBTP`}
              onDec={() => setField({ truePeak: clamp(Math.round((m.truePeak - 0.5) * 10) / 10, -3, 0) })}
              onInc={() => setField({ truePeak: clamp(Math.round((m.truePeak + 0.5) * 10) / 10, -3, 0) })}
            />
            <View style={styles.chipRow}>
              {DYNAMICS.map((d) => (
                <Chip
                  key={d}
                  label={t(`studio.master.dynamics.${d}`)}
                  active={m.dynamics === d}
                  onPress={() => setField({ dynamics: d })}
                />
              ))}
            </View>

            {/* master-EQ + multiband */}
            <Text style={[styles.section, { marginTop: 12 }]}>{t('studio.master.eq')}</Text>
            <Stepper
              label={t('studio.master.eqLow')}
              value={`${(m.eq?.low ?? 0) > 0 ? '+' : ''}${m.eq?.low ?? 0} dB`}
              onDec={() => setEq('low', -1)}
              onInc={() => setEq('low', 1)}
            />
            <Stepper
              label={t('studio.master.eqMid')}
              value={`${(m.eq?.mid ?? 0) > 0 ? '+' : ''}${m.eq?.mid ?? 0} dB`}
              onDec={() => setEq('mid', -1)}
              onInc={() => setEq('mid', 1)}
            />
            <Stepper
              label={t('studio.master.eqHigh')}
              value={`${(m.eq?.high ?? 0) > 0 ? '+' : ''}${m.eq?.high ?? 0} dB`}
              onDec={() => setEq('high', -1)}
              onInc={() => setEq('high', 1)}
            />
            <View style={[styles.chipRow, { marginTop: 8 }]}>
              <Chip
                label={t('studio.master.multiband')}
                active={!!m.multiband}
                onPress={() => setField({ multiband: !m.multiband })}
              />
            </View>

            <View style={{ gap: 8, marginTop: 12 }}>
              <PrimaryButton icon="pulse" label={t('studio.master.apply')} onPress={apply} />
              {applied ? (
                <Pressable onPress={turnOff} style={styles.offBtn}>
                  <Text style={styles.offText}>{t('studio.master.turnOff')}</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Egy mérő-sáv: a mért érték + (opcionális) cél-jelölés a min–max skálán. */
function Meter({
  label,
  value,
  target,
  min,
  max,
}: {
  label: string;
  value: number;
  target?: number;
  min: number;
  max: number;
}) {
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const tgt = target != null ? frac(target) : null;
  return (
    <View style={styles.meterRow}>
      <Text style={styles.meterLabel}>{label}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(frac(value) * 100)}%` }]} />
        {tgt != null ? <View style={[styles.meterTick, { left: `${Math.round(tgt * 100)}%` }]} /> : null}
      </View>
      <Text style={styles.meterVal}>{value.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  tap: { flex: 1 },
  sheet: {
    backgroundColor: '#0b0d14',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    maxHeight: '86%',
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  section: { color: palette.text, fontSize: 13, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  mixBlock: { paddingVertical: 4 },
  mixRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  mixLabel: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '600' },
  mixGain: { color: palette.textDim, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mixBtn: {
    width: 34,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soloText: { color: palette.textDim, fontSize: 13, fontWeight: '900' },
  hint: { color: palette.textDim, fontSize: 11, lineHeight: 16, marginTop: 8 },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  analyzeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  analyzeText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  meters: { marginTop: 10, marginBottom: 4, gap: 8 },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700', width: 44 },
  meterTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.surfaceHigh, position: 'relative' },
  meterFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: palette.accent },
  meterTick: { position: 'absolute', top: -2, bottom: -2, width: 2, backgroundColor: '#fff' },
  meterVal: { color: palette.text, fontSize: 11, fontWeight: '800', width: 42, textAlign: 'right', fontVariant: ['tabular-nums'] },
  spectrum: { width: '100%', height: 120, borderRadius: 10, marginTop: 10, backgroundColor: palette.surfaceHigh },
  offBtn: { alignItems: 'center', paddingVertical: 10 },
  offText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
});
