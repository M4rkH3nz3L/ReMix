import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export interface TextLayoutSectionsProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
}

/** az Extra tab eleje: igazítás, szöveg íven, maszk-felfedés */
export function TextLayoutSections({ clip, updateClip }: TextLayoutSectionsProps) {
  const { t: tr } = useTranslation();
  return (
    <>
      <PanelSection title={tr('panels.text.sectionAlign')}>
        <View style={styles.row}>
          {(
            [
              { id: 'left', x: 0.22 },
              { id: 'centerX', x: 0.5 },
              { id: 'right', x: 0.78 },
            ] as const
          ).map((a) => (
            <Chip
              key={a.id}
              label={tr('panels.text.align_' + a.id)}
              active={Math.abs(clip.position.x - a.x) < 0.03}
              onPress={() =>
                updateClip(clip.id, { position: { ...clip.position, x: a.x } })
              }
            />
          ))}
        </View>
        <View style={styles.row}>
          {(
            [
              { id: 'top', y: 0.16 },
              { id: 'centerY', y: 0.5 },
              { id: 'bottom', y: 0.8 },
            ] as const
          ).map((a) => (
            <Chip
              key={a.id}
              label={tr('panels.text.align_' + a.id)}
              active={Math.abs(clip.position.y - a.y) < 0.03}
              onPress={() =>
                updateClip(clip.id, { position: { ...clip.position, y: a.y } })
              }
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionTextPath')}>
        <View style={styles.row}>
          <Chip
            label={tr('common.none')}
            active={!clip.textPath}
            onPress={() => updateClip(clip.id, { textPath: undefined })}
          />
          {(['arc', 'valley', 'wave', 'circle'] as const).map((shape) => (
            <Chip
              key={shape}
              label={tr('panels.text.path_' + shape)}
              active={clip.textPath?.shape === shape}
              onPress={() =>
                updateClip(clip.id, { textPath: { curve: clip.textPath?.curve ?? 0.5, shape } })
              }
            />
          ))}
        </View>
        {clip.textPath && clip.textPath.shape !== 'circle' ? (
          <Stepper
            label={tr('panels.text.pathCurve')}
            value={`${Math.round(clip.textPath.curve * 100)}`}
            onDec={() =>
              updateClip(clip.id, {
                textPath: { ...clip.textPath!, curve: clamp(clip.textPath!.curve - 0.1, 0, 1) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                textPath: { ...clip.textPath!, curve: clamp(clip.textPath!.curve + 0.1, 0, 1) },
              })
            }
          />
        ) : null}
        {clip.textPath ? <Text style={styles.note}>{tr('panels.text.pathNote')}</Text> : null}
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionMaskText')}>
        <View style={styles.row}>
          <Chip
            label={tr('panels.text.maskReveal')}
            active={!!clip.maskReveal}
            onPress={() => updateClip(clip.id, { maskReveal: clip.maskReveal ? undefined : true })}
          />
        </View>
        <Text style={styles.note}>{tr('panels.text.maskRevealNote')}</Text>
      </PanelSection>
    </>
  );
}

export interface ToShapeSectionProps {
  shapeBusy: boolean;
  convertToShape: () => Promise<void>;
}

/** 🔁 szöveg → forma */
export function ToShapeSection({ shapeBusy, convertToShape }: ToShapeSectionProps) {
  const { t: tr } = useTranslation();
  return (
    <PanelSection title={tr('panels.text.sectionToShape')}>
      <PrimaryButton
        icon="shapes-outline"
        label={shapeBusy ? tr('panels.text.toShapeBusy') : tr('panels.text.toShape')}
        onPress={() => {
          void convertToShape();
        }}
      />
      <Text style={styles.note}>{tr('panels.text.toShapeNote')}</Text>
    </PanelSection>
  );
}
