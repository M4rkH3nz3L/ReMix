import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip } from '@/types/project';

/** 🖼️ Kép-stúdió gyors-nyitó (csak fotó-klipnél). Önálló szekció. */
export function ImageStudioSection({ clip }: { clip: ImageClip }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.filter.sectionImageStudio')}>
      <PrimaryButton
        icon="brush-outline"
        label={t('panels.filter.openImageStudio')}
        onPress={() => useEditorStore.getState().openImageStudio(clip.id)}
      />
      <Text style={{ color: palette.textDim, fontSize: 11, marginTop: 6, lineHeight: 16 }}>
        {t('panels.filter.imageStudioHint')}
      </Text>
    </PanelSection>
  );
}
