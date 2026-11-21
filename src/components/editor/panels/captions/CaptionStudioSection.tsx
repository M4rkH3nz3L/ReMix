import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/captions/captionsStyles';
import { AiProviderPicker } from '@/components/editor/AiProviderPicker';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';

export interface CaptionStudioSectionProps {
  studioStatus: string | null;
  layoutStatus: string | null;
  wordStatus: string | null;
  runCaptionStudio: () => Promise<void>;
  runSpeakerColors: () => Promise<void>;
  runWordTimings: () => Promise<void>;
  runSmartPosition: () => Promise<void>;
  runSpeakerLabels: () => Promise<void>;
  runSafeZone: () => void;
}

/** ✨ Caption Studio: kiemelések + emoji, beszélők, karaoke-időzítés, okos pozíció, safe-zone */
export function CaptionStudioSection({
  studioStatus,
  layoutStatus,
  wordStatus,
  runCaptionStudio,
  runSpeakerColors,
  runWordTimings,
  runSmartPosition,
  runSpeakerLabels,
  runSafeZone,
}: CaptionStudioSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title="✨ Caption Studio">
      <AiProviderPicker task="captionStudio" />
      <PrimaryButton
        icon="flash-outline"
        label={studioStatus ?? t('panels.captions.highlightsEmoji')}
        onPress={() => {
          if (studioStatus) {
            return;
          }
          void runCaptionStudio();
        }}
      />
      <View style={styles.row}>
        <Chip
          label={layoutStatus ?? t('panels.captions.speakerColorsChip')}
          active={false}
          onPress={() => {
            if (!layoutStatus) {
              void runSpeakerColors();
            }
          }}
        />
        <Chip
          label={wordStatus ?? t('panels.captions.wordTimingChip')}
          active={false}
          onPress={() => {
            if (!wordStatus) {
              void runWordTimings();
            }
          }}
        />
        <Chip
          label={layoutStatus ?? t('panels.captions.smartPositionChip')}
          active={false}
          onPress={() => {
            if (!layoutStatus) {
              void runSmartPosition();
            }
          }}
        />
        <Chip
          label={layoutStatus ?? t('panels.captions.speakerLabelsChip')}
          active={false}
          onPress={() => {
            if (!layoutStatus) {
              void runSpeakerLabels();
            }
          }}
        />
        <Chip
          label={t('panels.captions.safeZoneChip')}
          active={false}
          onPress={runSafeZone}
        />
      </View>
      <Text style={styles.note}>
        {t('panels.captions.captionStudioNote')}
      </Text>
      <Text style={styles.note}>
        {t('panels.captions.captionStudioNote2')}
      </Text>
    </PanelSection>
  );
}
