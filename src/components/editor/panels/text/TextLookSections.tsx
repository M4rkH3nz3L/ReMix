import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, ColorDot, PanelSection } from '@/components/ui/controls';
import { textColors, textStylePresets } from '@/constants/editor';
import { fontOptions, renderFontFamily } from '@/constants/fonts';
import type { EditorState } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export interface TextLookSectionsProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
}

/** stílus-preset, betűtípus, szín és háttér (a Stílus tab eleje) */
export function TextLookSections({ clip, updateClip }: TextLookSectionsProps) {
  const { t: tr } = useTranslation();
  return (
    <>
      <PanelSection title={tr('panels.text.sectionStylePreset')}>
        <View style={styles.row}>
          {textStylePresets.map((preset) => (
            <Chip
              key={preset.id}
              label={tr(preset.label)}
              active={(clip.stylePreset ?? 'plain') === preset.id}
              onPress={() => updateClip(clip.id, { stylePreset: preset.id })}
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionFont')}>
        <View style={styles.row}>
          {fontOptions.map((f) => {
            const active = (clip.fontFamily ?? undefined) === f.family;
            return (
              <Pressable
                key={f.id}
                onPress={() => updateClip(clip.id, { fontFamily: f.family })}
                style={[styles.fontChip, active && styles.fontChipActive]}
              >
                <Text
                  style={[
                    styles.fontChipText,
                    active && styles.fontChipTextActive,
                    { fontFamily: renderFontFamily(f.family) },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionColor')}>
        <View style={styles.row}>
          {textColors.map((color) => (
            <ColorDot
              key={color}
              color={color}
              active={clip.color === color}
              onPress={() => updateClip(clip.id, { color })}
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionBackground')}>
        <View style={styles.row}>
          <Chip
            label={tr('common.none')}
            active={clip.backgroundColor === null}
            onPress={() => updateClip(clip.id, { backgroundColor: null })}
          />
          {['#0c0d12cc', '#ffffffcc', '#6c5ce7cc'].map((color) => (
            <ColorDot
              key={color}
              color={color}
              active={clip.backgroundColor === color}
              onPress={() => updateClip(clip.id, { backgroundColor: color })}
            />
          ))}
        </View>
      </PanelSection>
    </>
  );
}
