import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/shape/shapeStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import type { EditorState } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** objektum-követés indítása / a követési kulcskockák törlése */
export function ShapeTrackSection({
  clip,
  updateClip,
  trackBusy,
  startTrackPick,
}: {
  clip: ShapeClip;
  updateClip: EditorState['updateClip'];
  trackBusy: boolean;
  startTrackPick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.shape.trackSectionTitle')}>
      <View style={styles.row}>
        <Chip
          label={trackBusy ? t('panels.shape.tracking') : t('panels.shape.trackObject')}
          active={trackBusy}
          onPress={startTrackPick}
        />
        {clip.keyframes?.x?.length ? (
          <Chip
            label={t('panels.shape.trackClear')}
            active={false}
            onPress={() => updateClip(clip.id, { keyframes: undefined })}
          />
        ) : null}
      </View>
      <Text style={styles.note}>{t('panels.shape.trackNote')}</Text>
    </PanelSection>
  );
}
