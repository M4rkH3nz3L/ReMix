import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { PathEditor } from '@/components/editor/PathEditor';
import { styles } from '@/components/editor/panels/shape/shapeStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** forma-fajta + toll (path) szerkesztő + path-animáció (rajzolás / morph) */
export function ShapeGeometrySections({ clip, updateClip }: { clip: ShapeClip; updateClip: EditorState['updateClip'] }) {
  const { t } = useTranslation();
  return (
    <>
      <PanelSection title={t('panels.shape.shapeTitle')}>
        <View style={styles.row}>
          {(
            [
              { id: 'rectangle', label: t('panels.shape.shapeRectangle') },
              { id: 'ellipse', label: t('panels.shape.shapeEllipse') },
              { id: 'line', label: t('panels.shape.shapeLine') },
            ] as const
          ).map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              active={clip.shape === s.id}
              onPress={() => updateClip(clip.id, { shape: s.id })}
            />
          ))}
        </View>
      </PanelSection>

      {clip.shape === 'path' ? (
        <PanelSection title={t('panels.shape.penTitle')}>
          <PathEditor
            points={clip.points ?? []}
            closed={clip.closed}
            onChange={(points) => updateClip(clip.id, { points })}
            onClosedChange={(closed) => updateClip(clip.id, { closed: closed || undefined })}
          />
          <Text style={styles.note}>{t('panels.shape.penNote')}</Text>
        </PanelSection>
      ) : null}

      {clip.shape === 'path' && (clip.points?.length ?? 0) >= 2 ? (
        <PanelSection title={t('panels.shape.pathAnimTitle')}>
          <View style={styles.row}>
            <Chip
              label={t('common.none')}
              active={!clip.pathAnim}
              onPress={() => updateClip(clip.id, { pathAnim: undefined })}
            />
            <Chip
              label={t('panels.shape.pathAnim_drawOn')}
              active={clip.pathAnim?.mode === 'drawOn'}
              onPress={() =>
                updateClip(clip.id, { pathAnim: { mode: 'drawOn', dur: clip.pathAnim?.dur ?? 1 } })
              }
            />
            <Chip
              label={t('panels.shape.pathAnim_morph')}
              active={clip.pathAnim?.mode === 'morph'}
              onPress={() =>
                updateClip(clip.id, {
                  pathAnim: { mode: 'morph', dur: clip.pathAnim?.dur ?? 1, to: clip.pathAnim?.to },
                })
              }
            />
          </View>
          {clip.pathAnim ? (
            <Stepper
              label={t('panels.shape.pathAnimDur')}
              value={`${(clip.pathAnim.dur ?? 1).toFixed(1)}s`}
              onDec={() =>
                updateClip(clip.id, {
                  pathAnim: { ...clip.pathAnim!, dur: clamp((clip.pathAnim!.dur ?? 1) - 0.2, 0.2, 8) },
                })
              }
              onInc={() =>
                updateClip(clip.id, {
                  pathAnim: { ...clip.pathAnim!, dur: clamp((clip.pathAnim!.dur ?? 1) + 0.2, 0.2, 8) },
                })
              }
            />
          ) : null}
          {clip.pathAnim?.mode === 'morph' ? (
            <>
              <Chip
                label={
                  clip.pathAnim.to
                    ? t('panels.shape.morphRecapture')
                    : t('panels.shape.morphCapture')
                }
                active={!!clip.pathAnim.to}
                onPress={() =>
                  updateClip(clip.id, { pathAnim: { ...clip.pathAnim!, to: clip.points } })
                }
              />
              <Text style={styles.note}>{t('panels.shape.morphNote')}</Text>
            </>
          ) : null}
        </PanelSection>
      ) : null}
    </>
  );
}
