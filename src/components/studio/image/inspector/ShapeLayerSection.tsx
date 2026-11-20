import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { GradientEditor } from '@/components/studio/image/GradientEditor';
import { updateLayer } from '@/lib/imageDoc';
import { CAPS, DASHES, defaultBorderAlign, JOINS, SHAPES } from '@/lib/layerInspectorOps';
import type { ImageDoc, ShapeLayer } from '@/types/project';

import { inspectorStyles as styles } from './inspectorStyles';

/** 🔷 forma-réteg: kitöltés/színátmenet, alak és paraméterei, kontúr (igazítás/stílus/vég/csatlakozás), árnyék, glow */
export function ShapeLayerSection({
  doc,
  layer,
  commit,
}: {
  doc: ImageDoc;
  layer: ShapeLayer;
  commit: (next: ImageDoc, label?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ColorField
        label={t('studio.image.fill')}
        value={layer.fill}
        onChange={(fill) => commit(updateLayer<ShapeLayer>(doc, layer.id, { fill }))}
      />
      <GradientEditor
        gradient={layer.gradient}
        baseColor={layer.fill}
        onChange={(gradient) => commit(updateLayer<ShapeLayer>(doc, layer.id, { gradient }))}
      />
      <View style={styles.chipRow}>
        {SHAPES.map((s) => (
          <Chip
            key={s}
            label={t(`studio.image.shape.${s}`)}
            active={layer.shape === s}
            onPress={() => commit(updateLayer<ShapeLayer>(doc, layer.id, { shape: s }))}
          />
        ))}
      </View>
      {layer.shape === 'rectangle' ? (
        <Slider
          label={t('studio.image.cornerRadius')}
          value={layer.cornerRadius ?? 0}
          min={0}
          max={0.5}
          onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { cornerRadius: v }))}
          format={(v) => v.toFixed(2)}
        />
      ) : null}
      {layer.shape === 'polygon' ? (
        <Slider
          label={t('studio.image.sides')}
          value={layer.sides ?? 6}
          min={3}
          max={12}
          onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { sides: Math.round(v) }), 'sides')}
          format={(v) => String(Math.round(v))}
        />
      ) : null}
      {layer.shape === 'star' ? (
        <>
          <Slider
            label={t('studio.image.starPoints')}
            value={layer.starPoints ?? 5}
            min={3}
            max={12}
            onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { starPoints: Math.round(v) }), 'star-points')}
            format={(v) => String(Math.round(v))}
          />
          <Slider
            label={t('studio.image.innerRadius')}
            value={layer.innerRadius ?? 0.5}
            min={0.1}
            max={0.9}
            onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { innerRadius: v }), 'star-inner')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      ) : null}
      {/* I26: a nyitott path egy vonal (`strokeWidth`, a kitöltés színével), minden más kontúros */}
      {layer.shape === 'path' && !layer.closed && !layer.subpaths?.length ? (
        <Slider
          label={t('studio.image.strokeWidth')}
          value={layer.strokeWidth ?? 0.9}
          min={0.1}
          max={5}
          onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { strokeWidth: v }), 'stroke-width')}
          format={(v) => v.toFixed(2)}
        />
      ) : (
        <Slider
          label={t('studio.image.strokeWidth')}
          value={layer.borderWidth ?? 0}
          min={0}
          max={2}
          onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderWidth: v }), 'border-width')}
          format={(v) => v.toFixed(2)}
        />
      )}
      {(layer.borderWidth ?? 0) > 0 ? (
        <ColorField
          label={t('studio.image.borderColor')}
          value={layer.borderColor ?? '#ffffff'}
          onChange={(borderColor) => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderColor }))}
        />
      ) : null}
      {/* 🖊️ S18: a körvonal igazítása (zárt formán) — belül / középen / kívül */}
      {(layer.borderWidth ?? 0) > 0 && (layer.shape !== 'path' || layer.closed || !!layer.subpaths?.length) && layer.shape !== 'line' ? (
        <View style={styles.chipRow}>
          {(['inside', 'center', 'outside'] as const).map((a) => (
            <Chip
              key={a}
              label={t(`studio.image.borderAlign.${a}`)}
              active={(layer.borderAlign ?? defaultBorderAlign(layer)) === a}
              onPress={() => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderAlign: a }), 'border-align')}
            />
          ))}
        </View>
      ) : null}
      {(layer.borderWidth ?? 0) > 0 || layer.shape === 'path' ? (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.stroke.style')}</Text>
          <View style={styles.chipRow}>
            {DASHES.map((d) => (
              <Chip
                key={d.value}
                label={t(d.labelKey)}
                active={(layer.strokeDash ?? 0) === d.value}
                onPress={() => commit(updateLayer<ShapeLayer>(doc, layer.id, { strokeDash: d.value || undefined }), t('studio.image.stroke.style'))}
              />
            ))}
          </View>
        </>
      ) : null}
      {layer.shape === 'path' ? (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.stroke.cap')}</Text>
          <View style={styles.chipRow}>
            {CAPS.map((c) => (
              <Chip key={c} label={t(`studio.image.stroke.cap_${c}`)} active={(layer.strokeCap ?? 'round') === c} onPress={() => commit(updateLayer<ShapeLayer>(doc, layer.id, { strokeCap: c }), t('studio.image.stroke.cap'))} />
            ))}
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.stroke.join')}</Text>
          <View style={styles.chipRow}>
            {JOINS.map((j) => (
              <Chip key={j} label={t(`studio.image.stroke.join_${j}`)} active={(layer.strokeJoin ?? 'round') === j} onPress={() => commit(updateLayer<ShapeLayer>(doc, layer.id, { strokeJoin: j }), t('studio.image.stroke.join'))} />
            ))}
          </View>
        </>
      ) : null}
      <ToggleRow
        icon="contrast"
        label={t('studio.image.shadow')}
        value={!!layer.shadow}
        onValueChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { shadow: v }))}
      />
      <ToggleRow
        icon="sparkles-outline"
        label={t('studio.image.glow')}
        value={!!layer.glow}
        onValueChange={(v) =>
          commit(
            updateLayer<ShapeLayer>(doc, layer.id, {
              glow: v ? { color: layer.fill, size: 2 } : undefined,
            })
          )
        }
      />
    </>
  );
}
