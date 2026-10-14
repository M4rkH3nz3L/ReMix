import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { GradientEditor } from '@/components/studio/image/GradientEditor';
import { palette } from '@/constants/editor';
import { getFilterAmount, hasFilter, IMAGE_FILTER_TYPES, setFilterAmount, toggleFilter } from '@/lib/imageFilters';
import { updateLayer } from '@/lib/imageDoc';
import { pickCubeLut } from '@/lib/media';
import { GRADES as GRADE_PRESETS } from '@/constants/grades';
import type {
  BlendMode,
  FillLayer,
  GradeId,
  ImageDoc,
  ImageLayer,
  PhotoLayer,
  ShapeLayer,
  TextLayer,
} from '@/types/project';

const BLENDS: (BlendMode | 'normal')[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'softlight',
  'hardlight',
  'difference',
  'exclusion',
  'colordodge',
  'colorburn',
];
const SHAPES: ShapeLayer['shape'][] = ['rectangle', 'ellipse', 'line', 'arrow', 'star'];

/**
 * 🎛️ Réteg-tulajdonság szerkesztő (a kijelölt réteg kontextuális vezérlői):
 * szöveg-stílus / fotó-illesztés+korrekció / forma kitöltés+blend+kontúr+árnyék+glow /
 * háttér-szín + minden rétegnél átlátszóság. Minden módosítás a command-buson (undo).
 *
 * Megosztott: a [LayerPanel](./LayerPanel.tsx) listája ALATT ÉS a dedikált „Stílus"
 * lapban ([LayerStyleSheet](./LayerStyleSheet.tsx)) — így a gazdag vezérlők a
 * kijelölésből KÖZVETLENÜL is elérhetők (felfedezhetőség), nem csak a réteg-fán át.
 */
export function LayerInspector({
  doc,
  layer,
  commit,
  onOpenAdjust,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onOpenAdjust: () => void;
}) {
  const { t } = useTranslation();

  // 🎞️ saját .cube LUT importálása a fotó-rétegre (pick + tartalmi validálás)
  const importLut = async (photo: PhotoLayer) => {
    const res = await pickCubeLut();
    if (res === null) {
      return; // elvetve
    }
    if (res === 'invalid') {
      Alert.alert(t('studio.image.lutInvalid', { defaultValue: 'Érvénytelen .cube LUT fájl.' }));
      return;
    }
    commit(updateLayer<PhotoLayer>(doc, photo.id, { lut: res.uri, lutName: res.name }));
  };

  return (
    <>
      {layer.kind === 'text' ? (
        <>
          <TextInput
            style={styles.textInput}
            value={layer.text}
            onChangeText={(text) =>
              commit(updateLayer<TextLayer>(doc, layer.id, { text }), t('studio.image.undoText'))
            }
            placeholder={t('studio.image.newText')}
            placeholderTextColor={palette.textDim}
            multiline
          />
          <ColorField
            label={t('studio.image.color')}
            value={layer.color}
            onChange={(color) => commit(updateLayer<TextLayer>(doc, layer.id, { color }))}
          />
          <Slider
            label={t('studio.image.fontSize')}
            value={layer.fontSize}
            min={2}
            max={40}
            onChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { fontSize: v }))}
            format={(v) => `${v.toFixed(1)}%`}
          />
          <View style={styles.chipRow}>
            {(['plain', 'outline', 'neon', 'bubble'] as const).map((p) => (
              <Chip
                key={p}
                label={t(`studio.image.preset.${p}`)}
                active={(layer.stylePreset ?? 'plain') === p}
                onPress={() => commit(updateLayer<TextLayer>(doc, layer.id, { stylePreset: p }))}
              />
            ))}
          </View>
          <ToggleRow
            icon="text"
            label={t('studio.image.bold')}
            value={layer.fontWeight === 'bold'}
            onValueChange={(v) =>
              commit(updateLayer<TextLayer>(doc, layer.id, { fontWeight: v ? 'bold' : 'normal' }))
            }
          />
          <Slider
            label={t('studio.image.tracking')}
            value={layer.letterSpacing ?? 0}
            min={-0.05}
            max={0.5}
            onChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { letterSpacing: v }))}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label={t('studio.image.leading')}
            value={layer.lineHeight ?? 1.2}
            min={0.8}
            max={2.5}
            onChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { lineHeight: v }))}
            format={(v) => v.toFixed(2)}
          />
          <ToggleRow
            icon="ellipse-outline"
            label={t('studio.image.outline')}
            value={!!layer.textStyle?.stroke}
            onValueChange={(v) =>
              commit(
                updateLayer<TextLayer>(doc, layer.id, {
                  textStyle: {
                    ...layer.textStyle,
                    stroke: v ? { color: '#000000', width: 0.06 } : undefined,
                  },
                })
              )
            }
          />
          {layer.textStyle?.stroke ? (
            <Slider
              label={t('studio.image.outlineWidth')}
              value={layer.textStyle.stroke.width}
              min={0.01}
              max={0.2}
              onChange={(v) =>
                commit(
                  updateLayer<TextLayer>(doc, layer.id, {
                    textStyle: {
                      ...layer.textStyle,
                      stroke: { color: layer.textStyle?.stroke?.color ?? '#000000', width: v },
                    },
                  })
                )
              }
              format={(v) => v.toFixed(2)}
            />
          ) : null}
          <ToggleRow
            icon="contrast"
            label={t('studio.image.shadow')}
            value={!!layer.textStyle?.shadow}
            onValueChange={(v) =>
              commit(
                updateLayer<TextLayer>(doc, layer.id, {
                  textStyle: {
                    ...layer.textStyle,
                    shadow: v ? { color: '#000000aa', dx: 0, dy: 0.03, blur: 0.05 } : undefined,
                  },
                })
              )
            }
          />
        </>
      ) : null}

      {layer.kind === 'photo' ? (
        <>
          <View style={styles.chipRow}>
            <Chip
              label={t('studio.image.fitCover')}
              active={layer.fit !== 'contain'}
              onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'cover' }))}
            />
            <Chip
              label={t('studio.image.fitContain')}
              active={layer.fit === 'contain'}
              onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'contain' }))}
            />
            <Chip label={t('studio.image.corrections')} active={false} onPress={onOpenAdjust} />
          </View>
          <Slider
            label={t('studio.image.rotation')}
            value={layer.rotation ?? 0}
            min={-180}
            max={180}
            onChange={(v) =>
              commit(updateLayer<PhotoLayer>(doc, layer.id, { rotation: Math.round(v) }))
            }
            format={(v) => `${Math.round(v)}°`}
          />
          {/* 🎛️ struktúra-szűrők (blur/sharpen/zaj/szürke/szépia) — a renderben (ffmpeg) */}
          <Text style={styles.sectionLabel}>{t('studio.image.filters', { defaultValue: 'Szűrők' })}</Text>
          <View style={styles.chipRow}>
            {IMAGE_FILTER_TYPES.map((f) => (
              <Chip
                key={f.type}
                label={t(`studio.image.filter.${f.type}`, { defaultValue: f.label })}
                active={hasFilter(layer.filters, f.type)}
                onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { filters: toggleFilter(layer.filters, f.type) }))}
              />
            ))}
          </View>
          {IMAGE_FILTER_TYPES.filter((f) => hasFilter(layer.filters, f.type)).map((f) => (
            <Slider
              key={f.type}
              label={t(`studio.image.filter.${f.type}`, { defaultValue: f.label })}
              value={getFilterAmount(layer.filters, f.type)}
              min={0}
              max={1}
              onChange={(v) => commit(updateLayer<PhotoLayer>(doc, layer.id, { filters: setFilterAmount(layer.filters, f.type, v) }))}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          ))}
          {/* 🎬 filmes look-presetek (LUT-szerű grade) — a videó grade-rétegével AZONOS térkép */}
          <Text style={styles.sectionLabel}>{t('studio.image.filmLook', { defaultValue: 'Filmes look' })}</Text>
          <View style={styles.chipRow}>
            {GRADE_PRESETS.map((g) => (
              <Chip
                key={g.id}
                label={t(g.label, { defaultValue: g.id })}
                active={(layer.grade ?? 'none') === g.id}
                onPress={() =>
                  commit(
                    updateLayer<PhotoLayer>(doc, layer.id, {
                      grade: g.id === 'none' ? undefined : (g.id as GradeId),
                    })
                  )
                }
              />
            ))}
          </View>
          {/* 🎞️ saját 3D LUT (.cube) — a render lut3d-del égeti; a kliens parseCubeLut validál */}
          <Text style={styles.sectionLabel}>{t('studio.image.customLut', { defaultValue: 'Saját LUT (.cube)' })}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={layer.lut ? t('studio.image.lutReplace', { defaultValue: 'LUT csere' }) : t('studio.image.lutImport', { defaultValue: 'LUT import' })}
              active={!!layer.lut}
              onPress={() => importLut(layer)}
            />
            {layer.lut ? (
              <Chip
                label={t('studio.image.lutClear', { defaultValue: 'LUT törlés' })}
                active={false}
                onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { lut: undefined, lutName: undefined }))}
              />
            ) : null}
          </View>
          {layer.lut ? <Text style={styles.hintText}>{layer.lutName ?? 'LUT.cube'}</Text> : null}
        </>
      ) : null}

      {layer.kind === 'shape' ? (
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
          <Slider
            label={t('studio.image.strokeWidth')}
            value={layer.borderWidth ?? 0}
            min={0}
            max={2}
            onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderWidth: v }))}
            format={(v) => v.toFixed(2)}
          />
          {(layer.borderWidth ?? 0) > 0 ? (
            <ColorField
              label={t('studio.image.borderColor')}
              value={layer.borderColor ?? '#ffffff'}
              onChange={(borderColor) => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderColor }))}
            />
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
      ) : null}

      {layer.kind === 'fill' ? (
        <>
          <ColorField
            label={t('studio.image.fill')}
            value={layer.fill}
            onChange={(fill) => commit(updateLayer<FillLayer>(doc, layer.id, { fill }))}
          />
          <GradientEditor
            gradient={layer.gradient}
            baseColor={layer.fill}
            onChange={(gradient) => commit(updateLayer<FillLayer>(doc, layer.id, { gradient }))}
          />
        </>
      ) : null}

      <Slider
        label={t('studio.image.opacity')}
        value={layer.opacity ?? 1}
        min={0.05}
        max={1}
        onChange={(v) => commit(updateLayer(doc, layer.id, { opacity: v }))}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      {/* 🎨 keverési mód — MINDEN réteg-fajtára (fill/photo/shape/text); a render ffmpeg-blenddel égeti */}
      <Text style={styles.sectionLabel}>{t('studio.image.blendMode', { defaultValue: 'Keverési mód' })}</Text>
      <View style={styles.chipRow}>
        {BLENDS.map((b) => (
          <Chip
            key={b}
            label={t(`studio.image.blend.${b}`, { defaultValue: b })}
            active={(layer.blendMode ?? 'normal') === b}
            onPress={() => commit(updateLayer(doc, layer.id, { blendMode: b === 'normal' ? undefined : b }))}
          />
        ))}
      </View>

      {/* 🌑 vetett árnyék — pozícionált rétegre (fotó/forma/szöveg) */}
      {layer.kind !== 'fill' ? (
        <View style={styles.chipRow}>
          <Chip
            label={t('studio.image.dropShadow', { defaultValue: 'Vetett árnyék' })}
            active={!!layer.dropShadow}
            onPress={() => commit(updateLayer(doc, layer.id, { dropShadow: layer.dropShadow ? undefined : true }))}
          />
          <Chip
            label={t('studio.image.glow', { defaultValue: 'Ragyogás' })}
            active={!!layer.outerGlow}
            onPress={() => commit(updateLayer(doc, layer.id, { outerGlow: layer.outerGlow ? undefined : true }))}
          />
        </View>
      ) : null}

      {/* 🎭 gradient-maszk: a réteg a megadott irányba fokozatosan átlátszóvá fade-el (a render geq-vel) */}
      <Text style={styles.sectionLabel}>{t('studio.image.maskFade', { defaultValue: 'Gradient-maszk (elhalványulás)' })}</Text>
      <View style={styles.chipRow}>
        {(['none', 'left', 'right', 'up', 'down'] as const).map((d) => (
          <Chip
            key={d}
            label={t(`studio.image.maskDir.${d}`, { defaultValue: d })}
            active={(layer.maskGradient ?? 'none') === d}
            onPress={() => commit(updateLayer(doc, layer.id, { maskGradient: d === 'none' ? undefined : d }))}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  textInput: {
    color: palette.text,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  sectionLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  hintText: { color: palette.textDim, fontSize: 11, fontStyle: 'italic' },
});
