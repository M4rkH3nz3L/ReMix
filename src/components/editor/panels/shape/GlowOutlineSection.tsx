import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/shape/shapeStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { GLOW_PRESETS, OUTLINE_PRESETS } from '@/lib/shapePanelOps';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** ragyogás (glow) és körvonal (outline) presetek + méretük */
export function GlowOutlineSection({ clip, updateClip }: { clip: ShapeClip; updateClip: EditorState['updateClip'] }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.shape.glowOutlineTitle')}>
      <Text style={styles.subLabel}>{t('panels.shape.glowLabel')}</Text>
      <View style={styles.row}>
        <Chip
          label={t('panels.shape.glowNone')}
          active={!clip.glow}
          onPress={() => updateClip(clip.id, { glow: undefined })}
        />
        {GLOW_PRESETS.map((g) => (
          <Chip
            key={g.id}
            label={g.emoji + ' ' + t('panels.shape.glowColor_' + g.id)}
            active={clip.glow?.color === g.color}
            onPress={() => updateClip(clip.id, { glow: { color: g.color, size: 2 } })}
          />
        ))}
      </View>
      {clip.glow ? (
        <Stepper
          label={t('panels.shape.glowSize')}
          value={`${clip.glow.size.toFixed(1)}%`}
          onDec={() =>
            updateClip(clip.id, {
              glow: { ...clip.glow!, size: clamp(clip.glow!.size - 0.4, 0.4, 6) },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              glow: { ...clip.glow!, size: clamp(clip.glow!.size + 0.4, 0.4, 6) },
            })
          }
        />
      ) : null}
      <Text style={styles.subLabel}>{t('panels.shape.outlineLabel')}</Text>
      <View style={styles.row}>
        <Chip
          label={t('panels.shape.outlineNone')}
          active={!clip.outline}
          onPress={() => updateClip(clip.id, { outline: undefined })}
        />
        {OUTLINE_PRESETS.map((o) => (
          <Chip
            key={o.id}
            label={o.emoji + ' ' + t('panels.shape.outlineColor_' + o.id)}
            active={clip.outline?.color === o.color}
            onPress={() => updateClip(clip.id, { outline: { color: o.color, width: 0.4 } })}
          />
        ))}
      </View>
      {clip.outline ? (
        <Stepper
          label={t('panels.shape.outlineWidth')}
          value={`${clip.outline.width.toFixed(2)}%`}
          onDec={() =>
            updateClip(clip.id, {
              outline: { ...clip.outline!, width: clamp(clip.outline!.width - 0.1, 0.1, 2) },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              outline: { ...clip.outline!, width: clamp(clip.outline!.width + 0.1, 0.1, 2) },
            })
          }
        />
      ) : null}
      <Text style={styles.note}>
        {t('panels.shape.glowOutlineNote')}
      </Text>
    </PanelSection>
  );
}
