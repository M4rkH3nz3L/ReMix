import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

/** 🎞️ Stabilizáció (csak videó). Önálló szekció — a klip stabilize-mezőjét írja. */
export function StabilizeSection({ clip }: { clip: VideoClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  return (
    <PanelSection title={t('panels.filter.sectionStabilize')}>
      <View style={styles.row}>
        <Chip
          label={t('panels.filter.stabilizeAuto')}
          active={!!clip.stabilize?.automatic}
          onPress={() =>
            updateClip(clip.id, {
              stabilize: clip.stabilize?.automatic
                ? undefined
                : { automatic: true, strength: 0.5, smoothness: 0.5, crop: 0.3 },
            })
          }
        />
      </View>
      {clip.stabilize?.automatic ? (
        <>
          <Stepper
            label={t('panels.filter.stabilizeStrength')}
            value={`${Math.round((clip.stabilize.strength ?? 0.5) * 100)}`}
            onDec={() =>
              updateClip(clip.id, {
                stabilize: { ...clip.stabilize!, strength: clamp((clip.stabilize!.strength ?? 0.5) - 0.1, 0, 1) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                stabilize: { ...clip.stabilize!, strength: clamp((clip.stabilize!.strength ?? 0.5) + 0.1, 0, 1) },
              })
            }
          />
          <Stepper
            label={t('panels.filter.stabilizeSmoothness')}
            value={`${Math.round((clip.stabilize.smoothness ?? 0.5) * 100)}`}
            onDec={() =>
              updateClip(clip.id, {
                stabilize: { ...clip.stabilize!, smoothness: clamp((clip.stabilize!.smoothness ?? 0.5) - 0.1, 0, 1) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                stabilize: { ...clip.stabilize!, smoothness: clamp((clip.stabilize!.smoothness ?? 0.5) + 0.1, 0, 1) },
              })
            }
          />
          <Stepper
            label={t('panels.filter.stabilizeCrop')}
            value={`${Math.round((clip.stabilize.crop ?? 0) * 100)}`}
            onDec={() =>
              updateClip(clip.id, {
                stabilize: { ...clip.stabilize!, crop: clamp((clip.stabilize!.crop ?? 0) - 0.1, 0, 1) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                stabilize: { ...clip.stabilize!, crop: clamp((clip.stabilize!.crop ?? 0) + 0.1, 0, 1) },
              })
            }
          />
          <View style={styles.row}>
            <Chip
              label={t('panels.filter.stabilizeRollingShutter')}
              active={!!clip.stabilize.rollingShutter}
              onPress={() =>
                updateClip(clip.id, {
                  stabilize: { ...clip.stabilize!, rollingShutter: !clip.stabilize!.rollingShutter },
                })
              }
            />
          </View>
          <Text style={styles.note}>{t('panels.filter.stabilizeNote')}</Text>
        </>
      ) : null}
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
