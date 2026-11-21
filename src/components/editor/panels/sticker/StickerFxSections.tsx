import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/sticker/stickerStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { BRUSH_COLORS, BRUSH_STYLES } from '@/lib/draw';
import { brushWidthStep, particlesFor } from '@/lib/stickerPanelOps';
import type { EditorState } from '@/store/editorStore';
import type { ParticlesConfig, ParticlesPreset } from '@/types/project';

const PARTICLE_PRESETS: { id: ParticlesPreset }[] = [
  { id: 'confetti' },
  { id: 'sparkle' },
  { id: 'snow' },
  { id: 'embers' },
];

export interface ParticlesSectionProps {
  particles: ParticlesConfig | undefined;
  dispatch: EditorState['dispatch'];
}

/** ✨ részecske-effekt (konfetti, szikra, hó, parázs) + beat-sync */
export function ParticlesSection({ particles, dispatch }: ParticlesSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.sticker.particlesTitle')}>
      <View style={styles.shapeRow3d}>
        <Chip
          label={t('common.none')}
          active={!particles}
          onPress={() => dispatch({ type: 'SET_PARTICLES', particles: null }, 'user')}
        />
        {PARTICLE_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            label={t('panels.sticker.particle_' + preset.id)}
            active={particles?.preset === preset.id}
            onPress={() =>
              dispatch(
                {
                  type: 'SET_PARTICLES',
                  particles: particlesFor(preset.id, particles),
                },
                'user'
              )
            }
          />
        ))}
      </View>
      {particles ? (
        <View style={styles.shapeRow3d}>
          <Chip
            label={particles.beatSync ? t('panels.sticker.beatSyncOn') : t('panels.sticker.beatSyncOff')}
            active={particles.beatSync}
            onPress={() =>
              dispatch(
                {
                  type: 'SET_PARTICLES',
                  particles: { ...particles, beatSync: !particles.beatSync },
                },
                'user'
              )
            }
          />
        </View>
      ) : null}
      <Text style={styles.note}>
        {t('panels.sticker.particlesNote')}
      </Text>
    </PanelSection>
  );
}

export interface DrawSectionProps {
  drawBrush: EditorState['drawBrush'];
  setDrawBrush: EditorState['setDrawBrush'];
}

/** 🖌️ szabadkézi rajz: ecset-stílus, szín, vastagság */
export function DrawSection({ drawBrush, setDrawBrush }: DrawSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.sticker.drawTitle')}>
      <View style={styles.chipRow}>
        {BRUSH_STYLES.map((b) => (
          <Chip
            key={b.id}
            label={b.label}
            active={drawBrush?.style === b.id}
            onPress={() =>
              setDrawBrush(
                drawBrush?.style === b.id
                  ? null
                  : {
                      color: drawBrush?.color ?? BRUSH_COLORS[0],
                      width: b.width,
                      style: b.id,
                      glow: b.glow,
                    }
              )
            }
          />
        ))}
      </View>
      {drawBrush ? (
        <>
          <Text style={styles.subLabel}>{t('panels.sticker.color')}</Text>
          <View style={styles.chipRow}>
            {BRUSH_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setDrawBrush({ ...drawBrush, color: c })}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  drawBrush.color === c ? styles.swatchActive : null,
                ]}
              />
            ))}
          </View>
          <Stepper
            label={t('panels.sticker.thickness')}
            value={`${drawBrush.width.toFixed(1)}%`}
            onDec={() =>
              setDrawBrush({
                ...drawBrush,
                width: brushWidthStep(drawBrush.width, -1),
              })
            }
            onInc={() =>
              setDrawBrush({
                ...drawBrush,
                width: brushWidthStep(drawBrush.width, 1),
              })
            }
          />
          <Chip
            label={t('panels.sticker.drawEnd')}
            active={false}
            onPress={() => setDrawBrush(null)}
          />
        </>
      ) : null}
      <Text style={styles.note}>
        {t('panels.sticker.drawNote')}
      </Text>
    </PanelSection>
  );
}
