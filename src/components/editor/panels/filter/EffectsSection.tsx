import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import {
  addEffect,
  moveEffect,
  removeEffect,
  setEffectAmount,
  toggleEffect,
  VIDEO_EFFECTS,
  VIDEO_EFFECT_TYPES,
} from '@/lib/videoEffects';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🎛️ Effekt-lánc (audit §6.5): rendezhető, sorrend-függő effektek. Önálló
 * szekció — csak a klip effekt-listáját írja a command-buson.
 */
export function EffectsSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  return (
    <PanelSection title={t('panels.filter.sectionEffects', { defaultValue: '🎛️ Effekt-lánc' })}>
      <View style={styles.row}>
        {VIDEO_EFFECT_TYPES.map((type) => (
          <Chip
            key={type}
            label={`+ ${t(VIDEO_EFFECTS[type].label, { defaultValue: type })}`}
            active={false}
            onPress={() =>
              updateClip(clip.id, { effects: addEffect(clip.effects, type, () => makeId('fx')) })
            }
          />
        ))}
      </View>
      {(clip.effects ?? []).map((fx) => (
        <View key={fx.id} style={styles.row}>
          <Chip
            label={`${fx.enabled === false ? '⦸ ' : ''}${t(VIDEO_EFFECTS[fx.type].label, { defaultValue: fx.type })}`}
            active={fx.enabled !== false}
            onPress={() => updateClip(clip.id, { effects: toggleEffect(clip.effects, fx.id) })}
          />
          <Chip
            label="↑"
            active={false}
            onPress={() => updateClip(clip.id, { effects: moveEffect(clip.effects, fx.id, -1) })}
          />
          <Chip
            label="↓"
            active={false}
            onPress={() => updateClip(clip.id, { effects: moveEffect(clip.effects, fx.id, 1) })}
          />
          <Chip
            label="✕"
            active={false}
            onPress={() => updateClip(clip.id, { effects: removeEffect(clip.effects, fx.id) })}
          />
          {VIDEO_EFFECTS[fx.type].parametric ? (
            <Stepper
              label={t('panels.filter.strength')}
              value={`${Math.round((fx.amount ?? VIDEO_EFFECTS[fx.type].defaultAmount) * 100)}%`}
              onDec={() =>
                updateClip(clip.id, {
                  effects: setEffectAmount(clip.effects, fx.id, (fx.amount ?? 0.5) - 0.1),
                })
              }
              onInc={() =>
                updateClip(clip.id, {
                  effects: setEffectAmount(clip.effects, fx.id, (fx.amount ?? 0.5) + 0.1),
                })
              }
            />
          ) : null}
        </View>
      ))}
      <Text style={styles.note}>
        {t('panels.filter.noteEffects', {
          defaultValue:
            'Rendezhető effekt-lánc — a sorrend számít. ↑/↓ átrendez, a névre koppintva ki/be, ✕ töröl.',
        })}
      </Text>
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
