import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/editor/panels/audio/audioStyles';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { TtsChoice } from '@/hooks/useTtsEngine';
import { logCaught } from '@/lib/logCaught';

export interface TtsSectionProps {
  ttsAvailable: boolean | null;
  ttsText: string;
  setTtsText: (text: string) => void;
  choices: TtsChoice[];
  selected: string | undefined;
  setSelected: (key: string) => void;
  ttsBusy: boolean;
  generateVoice: () => void;
  runDub: () => Promise<void>;
}

/** 🗣️ AI-hang (TTS) + dub feliratokból */
export function TtsSection({ ttsAvailable, ttsText, setTtsText, choices, selected, setSelected, ttsBusy, generateVoice, runDub }: TtsSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.audio.ttsTitle')}>
      {ttsAvailable === false ? (
        <Text style={styles.note}>
          {t('panels.audio.ttsUnavailable')}
        </Text>
      ) : (
        <>
          <TextInput
            value={ttsText}
            onChangeText={setTtsText}
            placeholder={t('panels.audio.ttsPlaceholder')}
            placeholderTextColor={palette.textDim}
            style={styles.ttsInput}
            multiline
          />
          {choices.length > 0 ? (
            <View style={styles.chipRow}>
              {choices.map((v) => (
                <Chip key={v.key} label={v.label} active={selected === v.key} onPress={() => setSelected(v.key)} />
              ))}
            </View>
          ) : null}
          {ttsBusy ? (
            <View style={styles.ttsBusy}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.note}>{t('panels.audio.ttsGenerating')}</Text>
            </View>
          ) : (
            <>
              <PrimaryButton icon="sparkles" label={t('panels.audio.generateVoice')} onPress={generateVoice} />
              <PrimaryButton
                icon="language-outline"
                label={t('panels.audio.dubBtn')}
                onPress={() => {
                  runDub().catch((err: Error) => { logCaught('components/editor/panels/AudioPanel.tsx:AudioPanel', err); return Alert.alert(t('panels.audio.dubTitle'), err.message); });
                }}
              />
            </>
          )}
          <Text style={styles.note}>
            {t('panels.audio.ttsHint')}
          </Text>
          <Text style={styles.note}>
            {t('panels.audio.dubNote')}
          </Text>
        </>
      )}
    </PanelSection>
  );
}
