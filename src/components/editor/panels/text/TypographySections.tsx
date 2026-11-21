import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { signedPercent } from '@/lib/textPanelOps';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export interface TextTypographyProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
}

/** tipográfia: betűköz, sorköz, alapvonal, alávágás */
export function TypographySection({ clip, updateClip }: TextTypographyProps) {
  const { t: tr } = useTranslation();
  return (
    <PanelSection title={tr('panels.text.sectionTypography')}>
      <Stepper
        label={tr('panels.text.tracking')}
        value={signedPercent(clip.letterSpacing ?? 0)}
        onDec={() => updateClip(clip.id, { letterSpacing: clamp((clip.letterSpacing ?? 0) - 0.02, -0.1, 1) })}
        onInc={() => updateClip(clip.id, { letterSpacing: clamp((clip.letterSpacing ?? 0) + 0.02, -0.1, 1) })}
      />
      <Stepper
        label={tr('panels.text.leading')}
        value={(clip.lineHeight ?? 1.25).toFixed(2)}
        onDec={() => updateClip(clip.id, { lineHeight: clamp((clip.lineHeight ?? 1.25) - 0.1, 0.8, 3) })}
        onInc={() => updateClip(clip.id, { lineHeight: clamp((clip.lineHeight ?? 1.25) + 0.1, 0.8, 3) })}
      />
      <Stepper
        label={tr('panels.text.baseline')}
        value={signedPercent(clip.baselineShift ?? 0)}
        onDec={() => updateClip(clip.id, { baselineShift: clamp((clip.baselineShift ?? 0) - 0.05, -1, 1) })}
        onInc={() => updateClip(clip.id, { baselineShift: clamp((clip.baselineShift ?? 0) + 0.05, -1, 1) })}
      />
      <View style={styles.row}>
        <Chip
          label={tr('panels.text.kerning')}
          active={clip.kerning !== false}
          onPress={() => updateClip(clip.id, { kerning: clip.kerning === false ? undefined : false })}
        />
      </View>
    </PanelSection>
  );
}

/** méret + félkövér (a Stílus tab vége) */
export function TextSizeSection({ clip, updateClip }: TextTypographyProps) {
  const { t: tr } = useTranslation();
  return (
    <PanelSection title={tr('panels.text.sectionSize')}>
      <Stepper
        label={tr('panels.text.sizeLabel')}
        value={`${clip.fontSize}%`}
        onDec={() =>
          updateClip(clip.id, { fontSize: clamp(clip.fontSize - 1, 3, 20) })
        }
        onInc={() =>
          updateClip(clip.id, { fontSize: clamp(clip.fontSize + 1, 3, 20) })
        }
      />
      <View style={styles.row}>
        <Chip
          label={tr('panels.text.bold')}
          active={clip.fontWeight === 'bold'}
          onPress={() =>
            updateClip(clip.id, {
              fontWeight: clip.fontWeight === 'bold' ? 'normal' : 'bold',
            })
          }
        />
      </View>
    </PanelSection>
  );
}
