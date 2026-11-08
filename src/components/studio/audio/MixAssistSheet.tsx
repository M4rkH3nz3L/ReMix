import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { AUDIO_MASTER_TARGETS } from '@/lib/audioMaster';
import { registerDevAction } from '@/lib/devActions';
import { logCaught } from '@/lib/logCaught';
import { masterProposal, mixSuggestions, type MixSuggestion, type TrackStats } from '@/lib/mixAssist';
import { analyzeMixTracks, measureMastered, type MixAnalysis } from '@/lib/mixAssistClient';
import { isRenderCancelledError } from '@/lib/render';
import { applyCommand, type EditorCommand } from '@/lib/commands';
import { useEditorStore } from '@/store/editorStore';
import { useMixAssist } from '@/store/mixAssistStore';
import { withCancellableProgress } from '@/store/progressStore';
import type { AudioMaster, AudioMasterTarget, Project } from '@/types/project';

/**
 * 🎚️🤖 Mixjavaslat és mastering-segéd (a telefonon, offline): a keverés sávonkénti mérése után
 * konkrét javaslatok indoklással — egyenként vagy együtt alkalmazva (egy-egy visszavonás) —, és a
 * célplatformhoz illő master, amit alkalmazás után a lap újramér: elérte-e a célt.
 */
export function MixAssistSheet() {
  const { t } = useTranslation();
  const open = useMixAssist((s) => s.open);
  const project = useEditorStore((s) => s.project);
  const past = useEditorStore((s) => s.past);
  const [analysis, setAnalysis] = useState<MixAnalysis | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // javaslat → az alkalmazása utáni projekt-állapot: „alkalmazva”, amíg ez az állapot a jelenlegi vagy a
  // visszavonható múltban van — visszavonás után a javaslat újra alkalmazható (nem ragad be a ✓)
  const [appliedAt, setAppliedAt] = useState<Map<string, Project>>(new Map());
  const [target, setTarget] = useState<AudioMasterTarget>(project?.audioMaster?.target ?? 'youtube');
  const [verify, setVerify] = useState<{ stats: TrackStats; lufs: number; tp: number; master: AudioMaster } | 'busy' | null>(null);
  const isApplied = (key: string) => {
    const r = appliedAt.get(key);
    return !!r && (r === project || past.includes(r));
  };

  const view = () => {
    const st = useEditorStore.getState();
    return { isTrackAudible: st.isTrackAudible, masterVolume: st.masterVolume };
  };
  const analyze = async (): Promise<MixAnalysis | null> => {
    const st = useEditorStore.getState();
    if (!st.project) return null;
    setAnalysis(null);
    setFailed(null);
    setAppliedAt(new Map());
    setVerify(null);
    try {
      const a = await withCancellableProgress(t('studio.audio.mixAssist.working'), (report, signal) => analyzeMixTracks(st.project!, view(), report, signal));
      if (!a) setFailed(t('studio.audio.check.kind.empty'));
      setAnalysis(a);
      return a;
    } catch (e) {
      logCaught('components/studio/audio/MixAssistSheet.tsx:analyze', e);
      if (!isRenderCancelledError(e)) setFailed((e as Error).message);
      return null;
    }
  };
  useEffect(() => {
    if (!open) return;
    // a következő ciklusban (az effektben ne legyen szinkron állapotváltás)
    const id = setTimeout(() => void analyzeRef.current(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;

  const suggestions = useMemo<MixSuggestion[]>(() => (analysis && project ? mixSuggestions(project, analysis.tracks) : []), [analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  const proposal = useMemo(() => (analysis ? masterProposal(analysis.mix, target, project?.audioMaster?.duckTrigger) : null), [analysis, target]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * a javaslatok parancsai MINDIG a mostani projektből számolódnak (sorban): ugyanarra a klipre
   * több effekt-javaslat is jöhet — a régi állapotból számolva a későbbi felülírná a korábbit
   */
  const commandsFor = (keys: MixSuggestion['key'][]): EditorCommand[] => {
    const st = useEditorStore.getState();
    if (!st.project || !analysis) return [];
    let p = st.project;
    const out: EditorCommand[] = [];
    for (const k of keys) {
      const s = mixSuggestions(p, analysis.tracks).find((x) => x.key === k);
      if (!s) continue;
      out.push(...s.commands);
      p = s.commands.reduce((acc, c) => applyCommand(acc, c) ?? acc, p);
    }
    return out;
  };
  /** egy köteg (egy visszavonás); az eredmény-állapot jelöli a javaslatokat alkalmazottnak */
  const applyKeys = (keys: MixSuggestion['key'][]) => {
    const cmds = commandsFor(keys);
    const n = cmds.length > 0 ? useEditorStore.getState().applyBatch(cmds, 'ai') : 0;
    const result = useEditorStore.getState().project;
    if (n > 0 && result) setAppliedAt((prev) => new Map([...prev, ...keys.map((k) => [k, result] as const)]));
    return n;
  };
  const applyOne = (key: MixSuggestion['key']) => (isApplied(key) ? 0 : applyKeys([key]));
  const applyAll = () => applyKeys(suggestions.map((s) => s.key).filter((k) => !isApplied(k)));
  const applyMaster = async () => {
    if (!proposal) return null;
    useEditorStore.getState().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: proposal.master }, 'ai');
    setVerify('busy');
    try {
      const st = useEditorStore.getState();
      const stats = await withCancellableProgress(t('studio.audio.mixAssist.verifying'), (report, signal) => measureMastered(st.project!, view(), report, signal));
      const v = stats ? { stats, lufs: proposal.master.lufs, tp: proposal.master.truePeak, master: proposal.master } : null;
      setVerify(v);
      return v;
    } catch (e) {
      logCaught('components/studio/audio/MixAssistSheet.tsx:verify', e);
      setVerify(null);
      return null;
    }
  };

  // 🧪 füstteszt (csak __DEV__)
  const ref = useRef({ analyze, applyAll, applyMaster, setTarget, suggestions, proposal, isApplied, verified: null as unknown });
  ref.current = { analyze, applyAll, applyMaster, setTarget, suggestions, proposal, isApplied, verified: null };
  useEffect(() => {
    const offs = [
      registerDevAction('mixAssist.suggestions', () => ref.current.suggestions.map((s) => s.key)),
      registerDevAction('mixAssist.applyAll', () => ref.current.applyAll()),
      registerDevAction('mixAssist.reanalyze', () => ref.current.analyze()),
      registerDevAction('mixAssist.proposal', () => ref.current.proposal),
      registerDevAction('mixAssist.targetSpotify', () => ref.current.setTarget('spotify')),
      registerDevAction('mixAssist.applyMaster', () => ref.current.applyMaster()),
      registerDevAction('mixAssist.appliedKeys', () => ref.current.suggestions.filter((s) => ref.current.isApplied(s.key)).map((s) => s.key)),
      registerDevAction('mixAssist.verifiedShown', () => ref.current.verified !== null),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  if (!open) return null;
  const lanes = audioLanes(project);
  const name = (type?: string | number) => {
    const lane = lanes.find((l) => l.type === type);
    return lane ? laneLabel(lane, t) : String(type ?? '');
  };
  const db = (x: number) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '−∞');
  // a mérés eredménye csak addig látszik, amíg ugyanez a master van a projekten (visszavonás után nem)
  const verified = verify && verify !== 'busy' && JSON.stringify(project?.audioMaster) === JSON.stringify(verify.master) ? verify : null;
  ref.current.verified = verified;
  const allApplied = suggestions.every((s) => isApplied(s.key));
  const hit = verified ? Math.abs(verified.stats.lufs - verified.lufs) <= 1 && 20 * Math.log10(verified.stats.peak) <= verified.tp + 0.3 : false;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => useMixAssist.getState().close()}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={() => useMixAssist.getState().close()} accessibilityLabel={t('common.close')} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.audio.mixAssist.title')}</Text>
            <Pressable onPress={() => useMixAssist.getState().close()} hitSlop={10} accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {!analysis ? (
              failed ? <Text style={styles.hint}>{failed}</Text> : <ActivityIndicator color={palette.accent} style={{ marginVertical: 24 }} />
            ) : (
              <>
                <Text style={styles.section}>{t('studio.audio.mixAssist.mixSection')}</Text>
                {suggestions.length === 0 ? (
                  <View style={styles.ok}>
                    <Ionicons name="checkmark-circle" size={20} color="#39d98a" />
                    <Text style={styles.okText}>{t('studio.audio.mixAssist.mixOk')}</Text>
                  </View>
                ) : (
                  suggestions.map((s, i) => (
                    <View key={i} style={styles.item}>
                      <Ionicons name={s.severity === 'error' ? 'alert-circle' : s.severity === 'warn' ? 'warning-outline' : 'bulb-outline'} size={18} color={s.severity === 'error' ? palette.danger : s.severity === 'warn' ? '#f5a524' : palette.accent} />
                      <Text style={styles.itemText}>{t(`studio.audio.mixAssist.s.${s.key}`, { ...s.params, track: name(s.params.track) })}</Text>
                      <Pressable onPress={() => applyOne(s.key)} disabled={isApplied(s.key)} style={[styles.apply, isApplied(s.key) && styles.applied]} accessibilityRole="button">
                        <Text style={styles.applyText}>{isApplied(s.key) ? '✓' : t('studio.audio.mixAssist.apply')}</Text>
                      </Pressable>
                    </View>
                  ))
                )}
                {suggestions.length > 1 ? (
                  <Pressable onPress={applyAll} style={[styles.wide, allApplied && { opacity: 0.4 }]} disabled={allApplied}>
                    <Text style={styles.wideText}>{t('studio.audio.mixAssist.applyAll', { count: suggestions.length })}</Text>
                  </Pressable>
                ) : null}

                <Text style={styles.section}>{t('studio.audio.mixAssist.masterSection')}</Text>
                <Text style={styles.hint}>{t('studio.audio.mixAssist.before', { lufs: analysis.mix.lufs.toFixed(1), peak: db(analysis.mix.peak), lra: proposal?.before.lra.toFixed(1) ?? '0' })}</Text>
                <View style={styles.chips}>
                  {AUDIO_MASTER_TARGETS.filter((x) => x !== 'custom').map((x) => (
                    <Chip key={x} label={t(`studio.master.target.${x}`)} active={target === x} onPress={() => setTarget(x)} />
                  ))}
                </View>
                {proposal?.reasons.map((r, i) => (
                  <View key={i} style={styles.reason}>
                    <Ionicons name="chevron-forward" size={14} color={palette.accent} />
                    <Text style={styles.reasonText}>{t(`studio.audio.mixAssist.r.${r.key}`, { ...r.params, target: t(`studio.master.target.${target}`) })}</Text>
                  </View>
                ))}
                <Pressable onPress={() => void applyMaster()} style={styles.wide} disabled={verify === 'busy'} testID="mix-assist-master">
                  <Text style={styles.wideText}>{t('studio.audio.mixAssist.applyMaster')}</Text>
                </Pressable>
                {verified ? (
                  <View style={styles.ok}>
                    <Ionicons name={hit ? 'checkmark-circle' : 'alert-circle'} size={20} color={hit ? '#39d98a' : '#f5a524'} />
                    <Text style={styles.okText}>{t(hit ? 'studio.audio.mixAssist.hit' : 'studio.audio.mixAssist.miss', { lufs: verified.stats.lufs.toFixed(1), target: verified.lufs, peak: db(verified.stats.peak), tp: verified.tp })}</Text>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  scrim: { flex: 1 },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, maxHeight: '86%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  body: { paddingBottom: 20, gap: 8 },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginTop: 10 },
  hint: { color: palette.textDim, fontSize: 12 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  okText: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceHigh },
  itemText: { flex: 1, color: palette.text, fontSize: 14 },
  apply: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: palette.accent },
  applied: { backgroundColor: '#39d98a' },
  applyText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  wide: { alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: palette.accent, marginTop: 4 },
  wideText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasonText: { flex: 1, color: palette.text, fontSize: 13 },
});
