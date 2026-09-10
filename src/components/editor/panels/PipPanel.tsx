import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip, ColorDot, PanelSection, Stepper } from '@/components/ui/controls';
import { palette, textColors } from '@/constants/editor';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { BlendMode, ImageClip, PipFrame, VideoClip } from '@/types/project';

/** lekerekítés-presetek (a rövidebb él arányában) */
const RADII: { id: string; value: number }[] = [
  { id: 'square', value: 0 },
  { id: 'rounded', value: 0.12 },
  { id: 'veryRound', value: 0.28 },
  { id: 'circle', value: 0.5 },
];

/** keverési módok a fő videóval (light-leak/overlay/dupla-expozíció) */
const BLENDS: { label: string; value: BlendMode }[] = [
  { label: '☀️ Screen', value: 'screen' },
  { label: '🌑 Multiply', value: 'multiply' },
  { label: '🎛️ Overlay', value: 'overlay' },
  { label: '⬆️ Lighten', value: 'lighten' },
];

/**
 * PiP-keret panel („webcam-bubble"): a pip-sávos klip lekerekítése + kerete +
 * árnyéka. A keret BELÜL van (a render pad-jével egyezik), a lekerekítés a
 * renderben `geq` alfával, az előnézetben natív borderRadius-szal — WYSIWYG.
 */
export function PipPanel({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const frame = clip.pipFrame ?? {};
  const radius = frame.radius ?? 0;
  const borderWidth = frame.borderWidth ?? 0;
  const borderColor = frame.borderColor ?? '#ffffff';
  const shadow = frame.shadow ?? false;

  const patch = (next: Partial<PipFrame>) =>
    updateClip(clip.id, { pipFrame: { ...frame, ...next } });

  return (
    <View>
      <PanelSection title={t('panels.pip.cornerRoundingTitle')}>
        <View style={styles.row}>
          {RADII.map((r) => (
            <Chip
              key={r.id}
              label={t('panels.pip.radius_' + r.id)}
              active={Math.abs(radius - r.value) < 0.02}
              onPress={() => patch({ radius: r.value })}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.pip.cornerRoundingNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.pip.borderTitle')}>
        <Stepper
          label={t('panels.pip.thickness')}
          value={`${Math.round(borderWidth * 1000) / 10}%`}
          onDec={() => patch({ borderWidth: clamp(borderWidth - 0.004, 0, 0.03) })}
          onInc={() => patch({ borderWidth: clamp(borderWidth + 0.004, 0, 0.03) })}
        />
        <View style={styles.row}>
          {textColors.map((color) => (
            <ColorDot
              key={color}
              color={color}
              active={borderColor.toLowerCase() === color.toLowerCase()}
              onPress={() => patch({ borderColor: color })}
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={t('panels.pip.blendTitle')}>
        <View style={styles.row}>
          <Chip
            label={t('common.none')}
            active={!frame.blendMode}
            onPress={() => patch({ blendMode: undefined })}
          />
          {BLENDS.map((b) => (
            <Chip
              key={b.value}
              label={b.label}
              active={frame.blendMode === b.value}
              onPress={() => patch({ blendMode: b.value })}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.pip.blendNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.pip.shadowTitle')}>
        <View style={styles.row}>
          <Chip label={t('common.none')} active={!shadow} onPress={() => patch({ shadow: false })} />
          <Chip label={t('panels.pip.dropShadow')} active={shadow} onPress={() => patch({ shadow: true })} />
        </View>
        <Text style={styles.note}>{t('panels.pip.shadowNote')}</Text>
      </PanelSection>

      {clip.pipFrame ? (
        <Chip
          label={t('common.reset')}
          active={false}
          onPress={() => updateClip(clip.id, { pipFrame: undefined })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
