import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/shape/shapeStyles';
import { Chip, ColorDot, PanelSection, Stepper } from '@/components/ui/controls';
import { textColors } from '@/constants/editor';
import { DEFAULT_GRADIENT, sortedStops } from '@/lib/gradient';
import { GRADIENTS } from '@/lib/shapePanelOps';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { ShapeClip, ShapeGradient } from '@/types/project';

/** kitöltés: szín, két-színű gradiens, fejlett (multi-stop) gradiens — képes formánál csak megjegyzés */
export function ShapeFillSection({ clip, updateClip }: { clip: ShapeClip; updateClip: EditorState['updateClip'] }) {
  const { t } = useTranslation();

  // 🌈 fejlett gradient (multi-stop lineáris / radiális / konikus) segédek
  const grad = clip.gradient;
  const setGradient = (g: ShapeGradient | undefined) => updateClip(clip.id, { gradient: g });
  const setGradType = (type: ShapeGradient['type']) =>
    setGradient(grad ? { ...grad, type } : { ...DEFAULT_GRADIENT, type });
  const setStops = (stops: ShapeGradient['stops']) =>
    grad && setGradient({ ...grad, stops });

  return clip.imageUri ? (
    <PanelSection title={t('panels.shape.imageTitle')}>
      <Text style={styles.note}>
        {t('panels.shape.imageNote')}
      </Text>
    </PanelSection>
  ) : (
    <PanelSection title={t('panels.shape.fillTitle')}>
      <View style={styles.row}>
        {textColors.map((color) => (
          <ColorDot
            key={color}
            color={color}
            active={!clip.fillGradient && clip.fill === color}
            onPress={() =>
              updateClip(clip.id, { fill: color, fillGradient: undefined })
            }
          />
        ))}
      </View>
      <View style={styles.row}>
        {GRADIENTS.map((g) => (
          <Chip
            key={g.id}
            label={t('panels.shape.gradient_' + g.id)}
            active={clip.fillGradient?.from === g.from}
            onPress={() =>
              updateClip(clip.id, { fillGradient: { from: g.from, to: g.to } })
            }
          />
        ))}
        {clip.fillGradient ? (
          <Chip
            label={t('panels.shape.plainColor')}
            active={false}
            onPress={() => updateClip(clip.id, { fillGradient: undefined })}
          />
        ) : null}
      </View>

      {/* 🌈 fejlett gradient: multi-stop lineáris / radiális / konikus */}
      <Text style={styles.subLabel}>{t('panels.shape.gradientAdvanced')}</Text>
      <View style={styles.row}>
        <Chip
          label={t('common.off')}
          active={!grad}
          onPress={() => setGradient(undefined)}
        />
        {(['linear', 'radial', 'conic'] as const).map((type) => (
          <Chip
            key={type}
            label={t('panels.shape.gradType_' + type)}
            active={grad?.type === type}
            onPress={() => setGradType(type)}
          />
        ))}
      </View>
      {grad ? (
        <>
          {grad.type !== 'radial' ? (
            <Stepper
              label={t('panels.shape.gradAngle')}
              value={`${Math.round(grad.angle ?? 135)}°`}
              onDec={() => setGradient({ ...grad, angle: ((grad.angle ?? 135) - 15 + 360) % 360 })}
              onInc={() => setGradient({ ...grad, angle: ((grad.angle ?? 135) + 15) % 360 })}
            />
          ) : null}
          {grad.stops.map((stop, i) => (
            <View key={i} style={styles.stopBlock}>
              <Text style={styles.stopLabel}>
                {t('panels.shape.gradStop')} {i + 1} · {Math.round(stop.at * 100)}%
              </Text>
              <View style={styles.row}>
                {textColors.map((color) => (
                  <ColorDot
                    key={color}
                    color={color}
                    active={stop.color === color}
                    onPress={() => setStops(grad.stops.map((s, j) => (j === i ? { ...s, color } : s)))}
                  />
                ))}
              </View>
              <View style={styles.row}>
                <Stepper
                  label={t('panels.shape.gradStopPos')}
                  value={`${Math.round(stop.at * 100)}`}
                  onDec={() =>
                    setStops(grad.stops.map((s, j) => (j === i ? { ...s, at: clamp(s.at - 0.05, 0, 1) } : s)))
                  }
                  onInc={() =>
                    setStops(grad.stops.map((s, j) => (j === i ? { ...s, at: clamp(s.at + 0.05, 0, 1) } : s)))
                  }
                />
                {grad.stops.length > 2 ? (
                  <Chip
                    label={t('common.remove')}
                    active={false}
                    onPress={() => setStops(grad.stops.filter((_, j) => j !== i))}
                  />
                ) : null}
              </View>
            </View>
          ))}
          <Chip
            label={t('panels.shape.gradAddStop')}
            active={false}
            onPress={() => setStops(sortedStops([...grad.stops, { color: '#ffffff', at: 0.5 }]))}
          />
        </>
      ) : null}
    </PanelSection>
  );
}
