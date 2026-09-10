import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, TransitionOut, VideoClip } from '@/types/project';

const STEP = 0.25;
const MAX_FADE = 2;

const TRANSITIONS: { id: TransitionOut['type'] }[] = [
  // 🧊 3D-jellegű
  { id: 'zoom' },
  { id: 'spin' },
  { id: 'flip' },
  { id: 'cube' },
  { id: 'circle' },
  { id: 'dissolve' },
  // 2D — wipe / csúszás
  { id: 'wipeLeft' },
  { id: 'wipeRight' },
  { id: 'wipeUp' },
  { id: 'wipeDown' },
  { id: 'slideLeft' },
  { id: 'slideRight' },
  // 2D — stílus
  { id: 'pixelize' },
  { id: 'blur' },
  { id: 'radial' },
  { id: 'fadeBlack' },
  { id: 'fadeWhite' },
];

/** Áttűnés feketéből/feketébe a klip szélein — az egymás utáni klipek
 * kimenő+bejövő fade-je együtt adja a vágásponti átúszást. */
export function TransitionPanel({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);

  const fadeIn = clip.fadeInSec ?? 0;
  const fadeOut = clip.fadeOutSec ?? 0;
  const half = clip.duration / 2;

  return (
    <View>
      <PanelSection title={t('panels.transition.fadeSectionTitle')}>
        <Stepper
          label={t('panels.transition.fadeIn')}
          value={fadeIn > 0 ? t('panels.transition.seconds', { value: fadeIn.toFixed(2) }) : t('panels.transition.noneValue')}
          onDec={() => updateClip(clip.id, { fadeInSec: clamp(fadeIn - STEP, 0, MAX_FADE) })}
          onInc={() =>
            updateClip(clip.id, { fadeInSec: clamp(fadeIn + STEP, 0, Math.min(MAX_FADE, half)) })
          }
        />
        <Stepper
          label={t('panels.transition.fadeOut')}
          value={fadeOut > 0 ? t('panels.transition.seconds', { value: fadeOut.toFixed(2) }) : t('panels.transition.noneValue')}
          onDec={() => updateClip(clip.id, { fadeOutSec: clamp(fadeOut - STEP, 0, MAX_FADE) })}
          onInc={() =>
            updateClip(clip.id, { fadeOutSec: clamp(fadeOut + STEP, 0, Math.min(MAX_FADE, half)) })
          }
        />
        <Text style={styles.note}>
          {t('panels.transition.fadeNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.transition.nextClipSectionTitle')}>
        <View style={styles.row}>
          <Chip
            label={t('common.none')}
            active={!clip.transitionOut}
            onPress={() => updateClip(clip.id, { transitionOut: undefined })}
          />
          {TRANSITIONS.map((tr) => (
            <Chip
              key={tr.id}
              label={t('panels.transition.type_' + tr.id)}
              active={clip.transitionOut?.type === tr.id}
              onPress={() =>
                updateClip(clip.id, {
                  transitionOut: {
                    type: tr.id,
                    duration: clip.transitionOut?.duration ?? 0.5,
                  },
                })
              }
            />
          ))}
        </View>
        {clip.transitionOut ? (
          <Stepper
            label={t('panels.transition.length')}
            value={t('panels.transition.seconds', { value: clip.transitionOut.duration.toFixed(2) })}
            onDec={() =>
              updateClip(clip.id, {
                transitionOut: {
                  ...clip.transitionOut!,
                  duration: clamp(clip.transitionOut!.duration - 0.1, 0.2, 1.5),
                },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                transitionOut: {
                  ...clip.transitionOut!,
                  duration: clamp(clip.transitionOut!.duration + 0.1, 0.2, 1.5),
                },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          {t('panels.transition.nextClipNote')}
        </Text>
      </PanelSection>
    </View>
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
