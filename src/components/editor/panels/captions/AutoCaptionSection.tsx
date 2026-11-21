import { useTranslation } from 'react-i18next';
import { Alert, Text } from 'react-native';

import { styles } from '@/components/editor/panels/captions/captionsStyles';
import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { isProRequiredError } from '@/lib/backend';
import { logCaught } from '@/lib/logCaught';
import { usePaywall } from '@/store/paywallStore';

export interface AutoCaptionSectionProps {
  aiStatus: string | null;
  setAiStatus: (status: string | null) => void;
  autoCaptions: () => Promise<void>;
}

/** 🎤 AI-felirat beszédből (Pro-kapu: a hibából nyílik a paywall) */
export function AutoCaptionSection({ aiStatus, setAiStatus, autoCaptions }: AutoCaptionSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.captions.autoCaptionSectionTitle')}>
      <PrimaryButton
        icon="sparkles-outline"
        label={aiStatus ?? t('panels.captions.captionFromSpeech')}
        onPress={() => {
          if (aiStatus) {
            return; // már fut
          }
          setAiStatus(t('panels.captions.startingStatus'));
          autoCaptions()
            .catch((err: Error) => {
            logCaught('components/editor/panels/CaptionsPanel.tsx:CaptionsPanel', err);
              if (isProRequiredError(err)) {
                usePaywall.getState().open(err.capability);
              } else {
                Alert.alert(t('panels.captions.aiCaption'), err.message);
              }
            })
            .finally(() => setAiStatus(null));
        }}
      />
      <Text style={styles.note}>
        {t('panels.captions.autoCaptionNote')}
      </Text>
    </PanelSection>
  );
}
