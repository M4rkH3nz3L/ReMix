import { useTranslation } from 'react-i18next';
import { Alert, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/editor/panels/captions/captionsStyles';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette, textStylePresets } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import type { TextStylePreset } from '@/types/project';

export interface CaptionInputSectionsProps {
  preset: TextStylePreset;
  setPreset: (preset: TextStylePreset) => void;
  raw: string;
  setRaw: (raw: string) => void;
  lines: string[];
  addCaptions: () => void;
  importSrt: () => Promise<void>;
}

/** stílus-preset, kézi felirat (soronként egy) és SRT-import */
export function CaptionInputSections({ preset, setPreset, raw, setRaw, lines, addCaptions, importSrt }: CaptionInputSectionsProps) {
  const { t } = useTranslation();
  return (
    <>
    <PanelSection title={t('panels.captions.styleSectionTitle')}>
      <View style={styles.row}>
        {textStylePresets.map((option) => (
          <Chip
            key={option.id}
            label={t('panels.captions.preset_' + option.id)}
            active={preset === option.id}
            onPress={() => setPreset(option.id)}
          />
        ))}
      </View>
    </PanelSection>

    <PanelSection title={t('panels.captions.manualSectionTitle')}>
      <TextInput
        value={raw}
        onChangeText={setRaw}
        multiline
        style={styles.input}
        placeholder={t('panels.captions.manualPlaceholder')}
        placeholderTextColor={palette.textDim}
      />
      <PrimaryButton
        icon="chatbox-ellipses-outline"
        label={
          lines.length > 0
            ? t('panels.captions.addCaptionsFromPlayhead', { count: lines.length })
            : t('panels.captions.writeAtLeastOneLine')
        }
        onPress={addCaptions}
      />
    </PanelSection>

    <PanelSection title={t('panels.captions.srtSectionTitle')}>
      <PrimaryButton
        icon="document-text-outline"
        label={t('panels.captions.importSrtButton')}
        onPress={() => {
          importSrt().catch((caught) => { logCaught('components/editor/panels/CaptionsPanel.tsx:CaptionsPanel', caught); return Alert.alert(t('common.error'), t('panels.captions.srtImportError')); });
        }}
      />
      <Text style={styles.note}>
        {t('panels.captions.srtNote')}
      </Text>
    </PanelSection>
    </>
  );
}
