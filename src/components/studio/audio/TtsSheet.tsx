import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { useTtsEngine } from '@/hooks/useTtsEngine';
import { registerDevAction } from '@/lib/devActions';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import type { AudioClip } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 🗣️ AI-hang (TTS) a stúdióban — szövegből beszéd a voiceover sávra, a playheadnél.
 * 📱 Offline-first (AP5): ha a telefonon van beszédhang, a telefon írja a WAV-ot (net nélkül, minden
 * szinten — a telefon dolgozik, nekünk nem kerül pénzbe). Különben a szerveres `/tts` (Pro: `guardPro`).
 * A klip a command buszon jön létre (undo).
 */
export function TtsSheet({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const engine = useTtsEngine(i18n.language);

  /** a kész hangfájl klipként a voiceover sávra, a playheadnél (egy undo) */
  const place = (uri: string, duration: number) => {
    const st = useEditorStore.getState();
    const project = st.project;
    if (!project) {
      return;
    }
    const clip: AudioClip = {
      id: makeId('clip'),
      kind: 'audio',
      start: snapToFrame(st.playhead, project.fps ?? 30),
      duration: duration || 4,
      trimIn: 0,
      sourceDuration: duration || 4,
      uri,
      label: t('panels.audio.aiVoiceLabel'),
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      source: 'voiceover',
    };
    st.addClip('voiceover', clip, {
      id: makeId('ast'),
      kind: 'audio',
      uri,
      provider: 'local',
      name: t('panels.audio.aiVoiceLabel'),
      duration: duration || undefined,
    });
  };

  const generate = async (): Promise<boolean> => {
    const value = text.trim();
    if (!value || busy) {
      return false;
    }
    setBusy(true);
    let ok = false;
    const run = async () => {
      const { uri, duration } = await engine.generate(value);
      place(uri, duration);
      ok = true;
      onClose();
    };
    try {
      // 📱 a telefonon: net és Pro nélkül; a szerveres hang Pro
      if (engine.needsPro) await guardPro(run, (err) => Alert.alert(t('panels.audio.aiVoiceLabel'), err.message));
      else await run();
      return ok;
    } catch (caught) {
      logCaught('components/studio/audio/TtsSheet.tsx:generate', caught);
      Alert.alert(t('panels.audio.aiVoiceLabel'), t('studio.audio.ttsFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // 🧪 füstteszt: szöveg + generálás (csak __DEV__)
  const genRef = useRef(generate);
  genRef.current = generate;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  useEffect(() => {
    const offs = [
      registerDevAction('tts.text', (arg) => setText(String(arg ?? ''))),
      registerDevAction('tts.generate', () => genRef.current()),
      registerDevAction('tts.voices', () => (engineRef.current.onDevice === null ? { device: null, server: 0 } : { device: engineRef.current.onDevice ? engineRef.current.choices.map((c) => c.label) : [], server: engineRef.current.onDevice ? 0 : engineRef.current.choices.length })),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.audio.ttsTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>

          {engine.available === false ? (
            <Text style={styles.empty}>{t('studio.audio.ttsUnavailable')}</Text>
          ) : (
            <>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('studio.audio.ttsPlaceholder')}
                placeholderTextColor={palette.textDim}
                multiline
                style={styles.input}
              />
              {engine.choices.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.voiceRow}>
                  {engine.choices.map((v) => (
                    <Chip key={v.key} label={v.label} active={engine.selected === v.key} onPress={() => engine.setSelected(v.key)} />
                  ))}
                </ScrollView>
              ) : null}
              {engine.onDevice ? <Text style={styles.note}>{t('studio.audio.ttsOnDevice')}</Text> : null}
              <PrimaryButton
                icon="sparkles"
                label={busy ? t('studio.audio.ttsWorking') : t('studio.audio.ttsGenerate')}
                onPress={() => void generate()}
                disabled={busy || !text.trim()}
              />
            </>
          )}
        </SafeAreaView>
      </View>
    </Modal>
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
    gap: 12,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  empty: { color: palette.textDim, fontSize: 13, paddingVertical: 12 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  voiceRow: { gap: 8, paddingVertical: 2 },
  note: { color: palette.textDim, fontSize: 11 },
});
