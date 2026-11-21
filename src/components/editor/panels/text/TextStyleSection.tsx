import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, ColorDot, PanelSection, Stepper } from '@/components/ui/controls';
import { textColors } from '@/constants/editor';
import { mergeTextStyle, signedPercent } from '@/lib/textPanelOps';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { TextClip, TextStyle } from '@/types/project';

export interface TextStyleSectionProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
}

/** 🎨 granuláris szöveg-stílus: gradiens, kontúr, árnyék, ragyogás, háttér-doboz */
export function TextStyleSection({ clip, updateClip }: TextStyleSectionProps) {
  const { t: tr } = useTranslation();
  // 🎨 granuláris szöveg-stílus (textStyle) segédek
  const ts = clip.textStyle ?? {};
  const setTs = (patch: Partial<TextStyle>) => {
    updateClip(clip.id, { textStyle: mergeTextStyle(ts, patch) });
  };
  return (
    <PanelSection title={tr('panels.text.sectionTextStyle')}>
      <View style={styles.row}>
        <Chip
          label={tr('panels.text.styleGradient')}
          active={!!ts.gradient}
          onPress={() =>
            setTs({ gradient: ts.gradient ? undefined : { from: clip.color, to: '#ffffff', angle: 135 } })
          }
        />
        <Chip
          label={tr('panels.text.styleStroke')}
          active={!!ts.stroke}
          onPress={() => setTs({ stroke: ts.stroke ? undefined : { color: '#000000', width: 0.04 } })}
        />
        <Chip
          label={tr('panels.text.styleShadow')}
          active={!!ts.shadow}
          onPress={() =>
            setTs({ shadow: ts.shadow ? undefined : { color: '#000000', dx: 0, dy: 0.04, blur: 0.06 } })
          }
        />
        <Chip
          label={tr('panels.text.styleGlow')}
          active={!!ts.glow}
          onPress={() => setTs({ glow: ts.glow ? undefined : { color: clip.color, size: 0.4 } })}
        />
        <Chip
          label={tr('panels.text.styleBg')}
          active={!!ts.background}
          onPress={() =>
            setTs({ background: ts.background ? undefined : { color: '#000000b3', padding: 0.4, radius: 0.3 } })
          }
        />
      </View>

      {ts.gradient ? (
        <>
          <Text style={styles.subLabel}>{tr('panels.text.styleGradientFrom')}</Text>
          <View style={styles.row}>
            {textColors.map((c) => (
              <ColorDot
                key={'gf' + c}
                color={c}
                active={ts.gradient!.from === c}
                onPress={() => setTs({ gradient: { ...ts.gradient!, from: c } })}
              />
            ))}
          </View>
          <Text style={styles.subLabel}>{tr('panels.text.styleGradientTo')}</Text>
          <View style={styles.row}>
            {textColors.map((c) => (
              <ColorDot
                key={'gt' + c}
                color={c}
                active={ts.gradient!.to === c}
                onPress={() => setTs({ gradient: { ...ts.gradient!, to: c } })}
              />
            ))}
          </View>
          <Stepper
            label={tr('panels.text.styleGradientAngle')}
            value={`${Math.round(ts.gradient.angle ?? 135)}°`}
            onDec={() => setTs({ gradient: { ...ts.gradient!, angle: ((ts.gradient!.angle ?? 135) - 15 + 360) % 360 } })}
            onInc={() => setTs({ gradient: { ...ts.gradient!, angle: ((ts.gradient!.angle ?? 135) + 15) % 360 } })}
          />
        </>
      ) : null}

      {ts.stroke ? (
        <>
          <Stepper
            label={tr('panels.text.styleStrokeWidth')}
            value={`${Math.round(ts.stroke.width * 100)}`}
            onDec={() => setTs({ stroke: { ...ts.stroke!, width: clamp(ts.stroke!.width - 0.01, 0, 0.2) } })}
            onInc={() => setTs({ stroke: { ...ts.stroke!, width: clamp(ts.stroke!.width + 0.01, 0, 0.2) } })}
          />
          <View style={styles.row}>
            {textColors.map((c) => (
              <ColorDot
                key={'sk' + c}
                color={c}
                active={ts.stroke!.color === c}
                onPress={() => setTs({ stroke: { ...ts.stroke!, color: c } })}
              />
            ))}
          </View>
        </>
      ) : null}

      {ts.glow ? (
        <>
          <Stepper
            label={tr('panels.text.styleGlowSize')}
            value={`${Math.round(ts.glow.size * 100)}`}
            onDec={() => setTs({ glow: { ...ts.glow!, size: clamp(ts.glow!.size - 0.1, 0, 1) } })}
            onInc={() => setTs({ glow: { ...ts.glow!, size: clamp(ts.glow!.size + 0.1, 0, 1) } })}
          />
          <View style={styles.row}>
            {textColors.map((c) => (
              <ColorDot
                key={'gl' + c}
                color={c}
                active={ts.glow!.color === c}
                onPress={() => setTs({ glow: { ...ts.glow!, color: c } })}
              />
            ))}
          </View>
        </>
      ) : null}

      {ts.shadow ? (
        <>
          <Stepper
            label={tr('panels.text.styleShadowBlur')}
            value={`${Math.round(ts.shadow.blur * 100)}`}
            onDec={() => setTs({ shadow: { ...ts.shadow!, blur: clamp(ts.shadow!.blur - 0.02, 0, 0.4) } })}
            onInc={() => setTs({ shadow: { ...ts.shadow!, blur: clamp(ts.shadow!.blur + 0.02, 0, 0.4) } })}
          />
          <Stepper
            label={tr('panels.text.styleShadowY')}
            value={signedPercent(ts.shadow.dy ?? 0)}
            onDec={() => setTs({ shadow: { ...ts.shadow!, dy: clamp((ts.shadow!.dy ?? 0) - 0.02, -0.3, 0.3) } })}
            onInc={() => setTs({ shadow: { ...ts.shadow!, dy: clamp((ts.shadow!.dy ?? 0) + 0.02, -0.3, 0.3) } })}
          />
        </>
      ) : null}

      {ts.background ? (
        <>
          <Stepper
            label={tr('panels.text.styleBgPadding')}
            value={`${Math.round(ts.background.padding * 100)}`}
            onDec={() => setTs({ background: { ...ts.background!, padding: clamp(ts.background!.padding - 0.1, 0, 2) } })}
            onInc={() => setTs({ background: { ...ts.background!, padding: clamp(ts.background!.padding + 0.1, 0, 2) } })}
          />
          <Stepper
            label={tr('panels.text.styleBgRadius')}
            value={`${Math.round(ts.background.radius * 100)}`}
            onDec={() => setTs({ background: { ...ts.background!, radius: clamp(ts.background!.radius - 0.1, 0, 2) } })}
            onInc={() => setTs({ background: { ...ts.background!, radius: clamp(ts.background!.radius + 0.1, 0, 2) } })}
          />
          <View style={styles.row}>
            {['#000000b3', '#ffffffcc', '#7c5cffcc', '#ff2ea6cc'].map((c) => (
              <ColorDot
                key={'bg' + c}
                color={c}
                active={ts.background!.color === c}
                onPress={() => setTs({ background: { ...ts.background!, color: c } })}
              />
            ))}
          </View>
        </>
      ) : null}
    </PanelSection>
  );
}
