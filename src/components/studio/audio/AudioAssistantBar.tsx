import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { ensureWhisperModel } from '@/components/studio/audio/SpeechEditBar';
import { palette } from '@/constants/editor';
import { ASR_HINT, intentCommands, parseAudioIntent, type AudioAction, type AudioIntentResult } from '@/lib/audioIntent';
import { registerDevAction } from '@/lib/devActions';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { transcribeMediaOnDevice } from '@/lib/whisperClient';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';

/**
 * 🎙️🤖 Hang-asszisztens (Hang Stúdió): a mondatot gépelés közben értelmezi (a telefonon, offline),
 * megmutatja a lépéseket és a nem értett részeket, és a „Végrehajtás”-ra egyetlen visszavonható
 * lépésként alkalmazza. A mikrofon-gomb a kimondott parancsot a Whisperrel írja át (szintén a
 * telefonon). A folyamat-műveletek (csendek, ütemvágás, ellenőrzés…) a stúdiónak mennek.
 */

const EXAMPLES = ['example1', 'example2', 'example3'];

/** a mostani állapot értelmezése (a felület és a füstteszt közös útja) */
export function parseNow(text: string, t: (k: string) => string): AudioIntentResult {
  const st = useEditorStore.getState();
  const project = st.project;
  if (!project) return { steps: [], actions: [], unknown: [] };
  const trackNames: Partial<Record<TrackType, string>> = {};
  for (const lane of audioLanes(project)) trackNames[lane.type] = laneLabel(lane, t);
  return parseAudioIntent(text, { project, playhead: st.playhead, selectedClipId: st.selectedClipId, trackNames, makeId });
}

/** végrehajtás: a lépések egy kötegben (egy undo), a műveletek a hívónak; @returns az alkalmazott parancsok száma */
export function applyIntent(r: AudioIntentResult, onActions: (a: AudioAction[]) => void): number {
  const cmds = intentCommands(r);
  const n = cmds.length > 0 ? useEditorStore.getState().applyBatch(cmds, 'ai') : 0;
  if (r.actions.length > 0) onActions(r.actions);
  return n;
}

export function AudioAssistantBar({ onActions, onClose }: { onActions: (a: AudioAction[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const selected = useEditorStore((s) => s.selectedClipId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => parseNow(text, t), [text, project, playhead, selected, t]);
  const typed = text.trim().length > 0;
  const runnable = result.steps.some((s) => s.commands.length > 0) || result.actions.length > 0;

  // 🎤 diktálás: felvétel → Whisper a telefonon → a szöveg a mezőbe
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const dictate = async () => {
    try {
      if (!listening) {
        if (!(await ensureWhisperModel(t))) return;
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('panels.audio.micPermissionTitle'), t('panels.audio.micPermissionMessage'));
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setListening(true);
        return;
      }
      setListening(false);
      setBusy(true);
      const uri = recorder.uri;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const r = uri ? await transcribeMediaOnDevice(uri, { prompt: ASR_HINT }) : null;
      const said = (r?.lines ?? []).map((l) => l.text).join(' ').trim();
      if (said) setText(said);
      else Alert.alert(t('studio.audio.assistant.title'), t('studio.audio.assistant.notHeard'));
    } catch (caught) {
      logCaught('components/studio/audio/AudioAssistantBar.tsx:dictate', caught);
      setListening(false);
    } finally {
      setBusy(false);
    }
  };

  // 🧪 füstteszt: szöveg beírása és végrehajtás (csak __DEV__)
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const offs = [
      registerDevAction('assistant.apply', () => applyIntent(parseNow(textRef.current, t), onActionsRef.current)),
    ];
    return () => offs.forEach((off) => off());
  }, [t]);
  const onActionsRef = useRef(onActions);
  onActionsRef.current = onActions;
  useEffect(() => {
    devSetText = setText;
    return () => {
      devSetText = null;
    };
  }, []);

  // a sáv a képernyő alján van: a billentyűzet fölé emelkedik
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View style={[styles.bar, { marginBottom: keyboard }]} testID="audio-assistant-bar">
      <View style={styles.row}>
        <Pressable onPress={onClose} style={styles.icon} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={18} color={palette.text} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('studio.audio.assistant.placeholder')}
          placeholderTextColor={palette.textDim}
          style={styles.input}
          returnKeyType="done"
          autoCorrect={false}
          multiline
        />
        <Pressable onPress={() => void dictate()} style={[styles.icon, listening && styles.mic]} disabled={busy} accessibilityRole="button" accessibilityLabel={t('studio.audio.assistant.dictate')}>
          {busy ? <ActivityIndicator size="small" color={palette.accent} /> : <Ionicons name={listening ? 'stop' : 'mic'} size={18} color={listening ? '#fff' : palette.accent} />}
        </Pressable>
        <Pressable
          onPress={() => {
            applyIntent(result, onActions);
            setText('');
            Keyboard.dismiss();
          }}
          disabled={!runnable}
          style={[styles.go, !runnable && { opacity: 0.4 }]}
          accessibilityRole="button"
        >
          <Text style={styles.goText}>{t('studio.audio.assistant.apply')}</Text>
        </Pressable>
      </View>
      {typed ? (
        <ScrollView style={styles.preview} contentContainerStyle={{ gap: 4 }}>
          {result.steps.map((s, i) => (
            <View key={`s${i}`} style={styles.line}>
              <Ionicons name={s.commands.length > 0 ? 'checkmark-circle' : 'information-circle-outline'} size={14} color={s.commands.length > 0 ? '#39d98a' : palette.textDim} />
              <Text style={styles.lineText}>{t(`studio.audio.assistant.step.${s.key}`, { ...s.params, target: s.params?.target ? t(`studio.master.target.${s.params.target}`) : '', fx: s.params?.fx ? String(s.params.fx).split('+').map((k) => t(`studio.audio.assistant.fx.${k}`)).join(', ') : '' })}</Text>
            </View>
          ))}
          {result.actions.map((a, i) => (
            <View key={`a${i}`} style={styles.line}>
              <Ionicons name="play-circle-outline" size={14} color={palette.accent} />
              <Text style={styles.lineText}>{t(`studio.audio.assistant.action.${a.kind}`, { track: 'track' in a ? a.track : '' })}</Text>
            </View>
          ))}
          {result.unknown.map((u, i) => (
            <View key={`u${i}`} style={styles.line}>
              <Ionicons name="help-circle-outline" size={14} color="#f5a524" />
              <Text style={[styles.lineText, { color: palette.textDim }]}>{t('studio.audio.assistant.unknown', { text: u })}</Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
          {EXAMPLES.map((k) => (
            <Pressable key={k} style={styles.example} onPress={() => setText(t(`studio.audio.assistant.${k}`))}>
              <Text style={styles.exampleText}>{t(`studio.audio.assistant.${k}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** 🧪 a füstteszt a mezőt is kitöltheti (a felület így ugyanazt mutatja, amit a teszt alkalmaz) */
let devSetText: ((s: string) => void) | null = null;
export function devTypeAssistant(s: string): void {
  devSetText?.(s);
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, backgroundColor: palette.surfaceHigh, borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border },
  mic: { backgroundColor: palette.danger, borderColor: palette.danger },
  input: { flex: 1, minHeight: 36, maxHeight: 90, color: palette.text, fontSize: 15, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: palette.surface },
  go: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: palette.accent },
  goText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  preview: { maxHeight: 120 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineText: { flex: 1, color: palette.text, fontSize: 13 },
  example: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: palette.border },
  exampleText: { color: palette.textDim, fontSize: 12 },
});
