import { useTranslation } from 'react-i18next';
import { Alert, Text } from 'react-native';

import { styles } from '@/components/editor/panels/audio/audioStyles';
import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { logCaught } from '@/lib/logCaught';
import { formatTime } from '@/lib/time';

/** 📂 Saját zenefájl importja */
export function OwnFileSection({ importOwn }: { importOwn: () => Promise<void> }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.audio.ownFileTitle')}>
      <PrimaryButton
        icon="folder-open-outline"
        label={t('panels.audio.importMusic')}
        onPress={() => {
          importOwn().catch((caught) => { logCaught('components/editor/panels/AudioPanel.tsx:AudioPanel', caught); return Alert.alert(t('common.error'), t('panels.audio.importFailed')); });
        }}
      />
    </PanelSection>
  );
}

export interface VoiceoverSectionProps {
  isRecording: boolean;
  durationMillis: number;
  toggleRecord: () => Promise<void>;
}

/** 🎙️ Voiceover-felvétel közvetlenül az appból */
export function VoiceoverSection({ isRecording, durationMillis, toggleRecord }: VoiceoverSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.audio.voiceoverTitle')}>
      <PrimaryButton
        icon={isRecording ? 'stop' : 'mic'}
        label={
          isRecording
            ? t('panels.audio.stopRecording', { time: formatTime(durationMillis / 1000) })
            : t('panels.audio.startRecording')
        }
        onPress={() => {
          toggleRecord().catch((caught) => {
            logCaught('components/editor/panels/AudioPanel.tsx:AudioPanel', caught);
            Alert.alert(t('common.error'), t('panels.audio.recordFailed'));
          });
        }}
      />
      <Text style={styles.note}>
        {t('panels.audio.voiceoverHint')}
      </Text>
    </PanelSection>
  );
}
