import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export interface Text3dSectionProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
}

/** 🧊 3D szöveg: anyag, mélység, dőlés */
export function Text3dSection({ clip, updateClip }: Text3dSectionProps) {
  const { t: tr } = useTranslation();
  return (
    <PanelSection title={tr('panels.text.section3d')}>
      <View style={styles.row}>
        <Chip
          label={tr('common.off')}
          active={!clip.text3d}
          onPress={() => updateClip(clip.id, { text3d: undefined })}
        />
        {(['chrome', 'gold', 'neon', 'plastic'] as const).map((material) => (
          <Chip
            key={material}
            label={tr('panels.text.material_' + material)}
            active={clip.text3d?.material === material}
            onPress={() =>
              updateClip(clip.id, {
                text3d: {
                  depth: clip.text3d?.depth ?? 0.5,
                  tiltX: clip.text3d?.tiltX ?? 10,
                  tiltY: clip.text3d?.tiltY ?? -12,
                  material,
                },
              })
            }
          />
        ))}
      </View>
      {clip.text3d ? (
        <>
          <Stepper
            label={tr('panels.text.depth')}
            value={`${Math.round(clip.text3d.depth * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                text3d: { ...clip.text3d!, depth: clamp(clip.text3d!.depth - 0.1, 0, 1) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                text3d: { ...clip.text3d!, depth: clamp(clip.text3d!.depth + 0.1, 0, 1) },
              })
            }
          />
          <Stepper
            label={tr('panels.text.tiltVertical')}
            value={`${clip.text3d.tiltX}°`}
            onDec={() =>
              updateClip(clip.id, {
                text3d: { ...clip.text3d!, tiltX: clamp(clip.text3d!.tiltX - 4, -45, 45) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                text3d: { ...clip.text3d!, tiltX: clamp(clip.text3d!.tiltX + 4, -45, 45) },
              })
            }
          />
          <Stepper
            label={tr('panels.text.tiltHorizontal')}
            value={`${clip.text3d.tiltY}°`}
            onDec={() =>
              updateClip(clip.id, {
                text3d: { ...clip.text3d!, tiltY: clamp(clip.text3d!.tiltY - 4, -45, 45) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                text3d: { ...clip.text3d!, tiltY: clamp(clip.text3d!.tiltY + 4, -45, 45) },
              })
            }
          />
          <Text style={styles.note}>{tr('panels.text.note3d')}</Text>
        </>
      ) : null}
    </PanelSection>
  );
}
