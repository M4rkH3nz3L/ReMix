import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { textAnimations } from '@/constants/editor';
import { kineticStaggerDefault } from '@/lib/textPanelOps';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export interface TextAnimSectionsProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
}

/** az Animáció tab: belépő-animáció + kinetikus tipográfia */
export function TextAnimSections({ clip, updateClip }: TextAnimSectionsProps) {
  const { t: tr } = useTranslation();
  return (
    <>
      <PanelSection title={tr('panels.text.sectionAnimation')}>
        <View style={styles.row}>
          {textAnimations.map((anim) => (
            <Chip
              key={anim.id}
              label={tr(anim.label)}
              active={clip.animation === anim.id && !clip.textMotion}
              onPress={() =>
                updateClip(clip.id, { animation: anim.id, textMotion: undefined })
              }
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionKinetic')}>
        <Text style={styles.subLabel}>{tr('panels.text.kineticPreset')}</Text>
        <View style={styles.row}>
          <Chip
            label={tr('common.none')}
            active={!clip.textMotion}
            onPress={() => updateClip(clip.id, { textMotion: undefined })}
          />
          {(['reveal', 'popIn', 'slideIn', 'typeOn', 'wave', 'bounce'] as const).map((preset) => (
            <Chip
              key={preset}
              label={tr('panels.text.kinetic_' + preset)}
              active={clip.textMotion?.preset === preset}
              onPress={() =>
                updateClip(clip.id, {
                  textMotion: { by: clip.textMotion?.by ?? 'word', ...clip.textMotion, preset },
                })
              }
            />
          ))}
        </View>
        {clip.textMotion ? (
          <>
            <Text style={styles.subLabel}>{tr('panels.text.kineticBy')}</Text>
            <View style={styles.row}>
              {(['char', 'word', 'line'] as const).map((by) => (
                <Chip
                  key={by}
                  label={tr('panels.text.kineticBy_' + by)}
                  active={clip.textMotion?.by === by}
                  onPress={() =>
                    updateClip(clip.id, { textMotion: { ...clip.textMotion!, by } })
                  }
                />
              ))}
            </View>
            {clip.textMotion.preset !== 'wave' ? (
              <>
                <Stepper
                  label={tr('panels.text.kineticStagger')}
                  value={`${Math.round((clip.textMotion.stagger ?? kineticStaggerDefault(clip.textMotion.by)) * 1000)}ms`}
                  onDec={() =>
                    updateClip(clip.id, {
                      textMotion: {
                        ...clip.textMotion!,
                        stagger: clamp((clip.textMotion!.stagger ?? 0.08) - 0.02, 0, 0.5),
                      },
                    })
                  }
                  onInc={() =>
                    updateClip(clip.id, {
                      textMotion: {
                        ...clip.textMotion!,
                        stagger: clamp((clip.textMotion!.stagger ?? 0.08) + 0.02, 0, 0.5),
                      },
                    })
                  }
                />
                <Stepper
                  label={tr('panels.text.kineticDur')}
                  value={`${(clip.textMotion.dur ?? 0.4).toFixed(2)}s`}
                  onDec={() =>
                    updateClip(clip.id, {
                      textMotion: {
                        ...clip.textMotion!,
                        dur: clamp((clip.textMotion!.dur ?? 0.4) - 0.1, 0.1, 2),
                      },
                    })
                  }
                  onInc={() =>
                    updateClip(clip.id, {
                      textMotion: {
                        ...clip.textMotion!,
                        dur: clamp((clip.textMotion!.dur ?? 0.4) + 0.1, 0.1, 2),
                      },
                    })
                  }
                />
              </>
            ) : null}
            <Text style={styles.note}>{tr('panels.text.kineticNote')}</Text>
          </>
        ) : null}
      </PanelSection>
    </>
  );
}
