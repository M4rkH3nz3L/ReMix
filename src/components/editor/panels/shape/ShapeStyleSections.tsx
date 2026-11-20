import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/shape/shapeStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { BLEND_MODES } from '@/constants/editor';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** keverési mód + méret és stílus (keret, szaggatás, vonalvég/-illesztés, átlátszóság, árnyék) */
export function ShapeStyleSections({ clip, updateClip }: { clip: ShapeClip; updateClip: EditorState['updateClip'] }) {
  const { t } = useTranslation();
  return (
    <>
      <PanelSection title={t('panels.shape.blendTitle')}>
        <View style={styles.row}>
          <Chip
            label={t('panels.shape.blendNormal')}
            active={!clip.blendMode}
            onPress={() => updateClip(clip.id, { blendMode: undefined })}
          />
          {BLEND_MODES.map((m) => (
            <Chip
              key={m.value}
              label={t(m.label)}
              active={clip.blendMode === m.value}
              onPress={() => updateClip(clip.id, { blendMode: m.value })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.shape.blendNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.shape.sizeStyleTitle')}>
        <Stepper
          label={t('panels.shape.width')}
          value={`${Math.round(clip.w * 100)}%`}
          onDec={() => updateClip(clip.id, { w: clamp(clip.w - 0.05, 0.05, 1) })}
          onInc={() => updateClip(clip.id, { w: clamp(clip.w + 0.05, 0.05, 1) })}
        />
        <Stepper
          label={t('panels.shape.height')}
          value={`${Math.round(clip.h * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { h: clamp(clip.h - 0.05, 0.004, 1) })
          }
          onInc={() => updateClip(clip.id, { h: clamp(clip.h + 0.05, 0.004, 1) })}
        />
        {clip.shape === 'rectangle' ? (
          <Stepper
            label={t('panels.shape.cornerRadius')}
            value={`${Math.round((clip.cornerRadius ?? 0) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                cornerRadius: clamp((clip.cornerRadius ?? 0) - 0.05, 0, 0.5),
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                cornerRadius: clamp((clip.cornerRadius ?? 0) + 0.05, 0, 0.5),
              })
            }
          />
        ) : null}
        <Stepper
          label={t('panels.shape.border')}
          value={`${(clip.borderWidth ?? 0).toFixed(1)}`}
          onDec={() =>
            updateClip(clip.id, {
              borderWidth: clamp((clip.borderWidth ?? 0) - 0.2, 0, 2),
              borderColor: clip.borderColor ?? '#ffffff',
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              borderWidth: clamp((clip.borderWidth ?? 0) + 0.2, 0, 2),
              borderColor: clip.borderColor ?? '#ffffff',
            })
          }
        />
        <Stepper
          label={t('panels.shape.strokeDash')}
          value={
            clip.strokeDash && clip.strokeDash > 0
              ? `${clip.strokeDash.toFixed(1)}×`
              : t('common.off')
          }
          onDec={() => updateClip(clip.id, { strokeDash: clamp((clip.strokeDash ?? 0) - 0.5, 0, 8) })}
          onInc={() => updateClip(clip.id, { strokeDash: clamp((clip.strokeDash ?? 0) + 0.5, 0, 8) })}
        />
        {clip.shape === 'path' ? (
          <>
            <Text style={styles.subLabel}>{t('panels.shape.strokeCap')}</Text>
            <View style={styles.row}>
              {(['round', 'butt', 'square'] as const).map((cap) => (
                <Chip
                  key={cap}
                  label={t('panels.shape.cap_' + cap)}
                  active={(clip.strokeCap ?? 'round') === cap}
                  onPress={() => updateClip(clip.id, { strokeCap: cap })}
                />
              ))}
            </View>
            <Text style={styles.subLabel}>{t('panels.shape.strokeJoin')}</Text>
            <View style={styles.row}>
              {(['round', 'miter', 'bevel'] as const).map((join) => (
                <Chip
                  key={join}
                  label={t('panels.shape.join_' + join)}
                  active={(clip.strokeJoin ?? 'round') === join}
                  onPress={() => updateClip(clip.id, { strokeJoin: join })}
                />
              ))}
            </View>
          </>
        ) : null}
        <Stepper
          label={t('panels.shape.opacity')}
          value={`${Math.round((clip.opacity ?? 1) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) - 0.1, 0.1, 1) })
          }
          onInc={() =>
            updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) + 0.1, 0.1, 1) })
          }
        />
        <View style={styles.row}>
          <Chip
            label={clip.shadow ? t('panels.shape.shadowOn') : t('panels.shape.shadow')}
            active={clip.shadow === true}
            onPress={() => updateClip(clip.id, { shadow: !clip.shadow })}
          />
        </View>
        <Text style={styles.note}>
          {t('panels.shape.sizeStyleNote')}
        </Text>
      </PanelSection>
    </>
  );
}

/** igazítás: a vászon-rács (ki / 6×6 / 12×12) */
export function ShapeAlignSection({ snapGrid, setSnapGrid }: { snapGrid: number; setSnapGrid: EditorState['setSnapGrid'] }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.shape.alignTitle')}>
      <View style={styles.row}>
        {[
          { v: 0, label: t('panels.shape.gridOff') },
          { v: 6, label: '6×6' },
          { v: 12, label: '12×12' },
        ].map((g) => (
          <Chip
            key={g.v}
            label={g.label}
            active={snapGrid === g.v}
            onPress={() => setSnapGrid(g.v)}
          />
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.shape.alignNote')}
      </Text>
    </PanelSection>
  );
}
