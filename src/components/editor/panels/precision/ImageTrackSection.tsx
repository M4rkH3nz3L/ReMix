import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/precision/precisionStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import type { EditorState } from '@/store/editorStore';
import type { ImageClip } from '@/types/project';

/** a kép objektum-követésének indítása / a követési kulcskockák törlése */
export function ImageTrackSection({
  clip,
  updateClip,
  trackBusy,
  startTrackPick,
}: {
  clip: ImageClip;
  updateClip: EditorState['updateClip'];
  trackBusy: boolean;
  startTrackPick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.trackSectionTitle')}>
      <View style={styles.row}>
        <Chip
          label={trackBusy ? t('panels.precision.tracking') : t('panels.precision.trackObject')}
          active={trackBusy}
          onPress={startTrackPick}
        />
        {clip.keyframes?.x?.length ? (
          <Chip
            label={t('panels.precision.trackClear')}
            active={false}
            onPress={() => updateClip(clip.id, { keyframes: undefined })}
          />
        ) : null}
      </View>
      <Text style={styles.range}>{t('panels.precision.trackNote')}</Text>
    </PanelSection>
  );
}
