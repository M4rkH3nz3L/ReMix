import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { fetchTtsVoices, generateTts, type TtsVoice } from '@/lib/tts';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import type { AudioClip } from '@/types/project';

/**
 * 🗣️ AI-hang (TTS) a stúdióban — szövegből beszéd a voiceover sávra, a playheadnél.
 * A generálás Pro (a worker `/tts` proOnly) → `guardPro` nyitja a paywallt, ha
 * kell. A klip a command buszon jön létre (undo). Az AudioPanel TTS-ét hasznosítja
 * újra (`@/lib/tts`).
 */
export function TtsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voice, setVoice] = useState<string | undefined>(undefined);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchTtsVoices()
      .then((r) => {
        if (alive) {
          setAvailable(r.available);
          setVoices(r.voices);
          setVoice(r.voices[0]?.name);
        }
      })
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  const generate = () => {
    const value = text.trim();
    if (!value || busy) {
      return;
    }
    setBusy(true);
    guardPro(
      async () => {
        const { uri, duration } = await generateTts(value, voice);
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
        onClose();
      },
      (err) => Alert.alert(t('panels.audio.aiVoiceLabel'), err.message)
    ).finally(() => setBusy(false));
  };

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

          {available === false ? (
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
              {voices.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.voiceRow}>
                  {voices.map((v) => (
                    <Chip key={v.name} label={v.locale} active={voice === v.name} onPress={() => setVoice(v.name)} />
                  ))}
                </ScrollView>
              ) : null}
              <PrimaryButton
                icon="sparkles"
                label={busy ? t('studio.audio.ttsWorking') : t('studio.audio.ttsGenerate')}
                onPress={generate}
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
});
