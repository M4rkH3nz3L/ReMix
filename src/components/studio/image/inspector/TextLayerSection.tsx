import { fontOptions, renderFontFamily } from '@/constants/fonts';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { palette } from '@/constants/editor';
import { updateLayer } from '@/lib/imageDoc';
import { TEXT_ALIGNS } from '@/lib/layerInspectorOps';
import { withProjectFont } from '@/lib/projectFonts';
import { loadProjectFonts, pickAndImportFont } from '@/lib/projectFontsClient';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ProjectFont, TextLayer, TextPath } from '@/types/project';

import { inspectorStyles } from './inspectorStyles';

/** 🔤 szöveg-réteg: tartalom, szín, font (+ saját font import), igazítás, stílus, kontúr/árnyék, görbe */
export function TextLayerSection({
  doc,
  layer,
  commit,
  projectFonts,
}: {
  doc: ImageDoc;
  layer: TextLayer;
  commit: (next: ImageDoc, label?: string) => void;
  projectFonts: ProjectFont[] | undefined;
}) {
  const { t } = useTranslation();
  const importFont = async (layerId: string) => {
    const res = await pickAndImportFont();
    if (!res.ok) {
      if (res.reason !== 'cancelled') Alert.alert(t('studio.image.fonts.import'), t(`studio.image.fonts.${res.reason}`));
      return;
    }
    await loadProjectFonts([res.font]);
    const st = useEditorStore.getState();
    const fresh = st.project?.imageDocs?.find((d) => d.id === doc.id) ?? doc;
    st.applyBatch(
      [
        { type: 'SET_PROJECT_FONTS', fonts: withProjectFont(st.project?.fonts, res.font) },
        { type: 'UPSERT_IMAGE_DOC', doc: updateLayer<TextLayer>(fresh, layerId, { fontFamily: res.font.family }), label: t('studio.image.font') },
      ],
      'user'
    );
  };

  return (
    <>
      <TextInput maxFontSizeMultiplier={1.3} accessibilityLabel={t('studio.image.a11y.textContent')}
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
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.font')}</Text>
      <View style={styles.chipRow}>
        {[...(projectFonts ?? []).map((f) => ({ id: f.family, label: f.name, family: f.family })), ...fontOptions.filter((f) => f.family)].map((f) => (
          <Pressable
            key={f.id}
            style={[styles.fontChip, layer.fontFamily === f.family ? styles.fontChipActive : null]}
            onPress={() => commit(updateLayer<TextLayer>(doc, layer.id, { fontFamily: f.family }), t('studio.image.font'))}
            accessibilityRole="button"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: layer.fontFamily === f.family }}
          >
            <Text maxFontSizeMultiplier={1.3} style={[styles.fontChipText, { fontFamily: renderFontFamily(f.family) }]} numberOfLines={1}>
              {f.label}
            </Text>
          </Pressable>
        ))}
        {/* 🔤 S10: saját font a Fájlokból — a projektbe kerül, és ez a réteg rögtön azt kapja (egy visszavonás) */}
        <Pressable
          style={styles.fontChip}
          onPress={() => void importFont(layer.id)}
          accessibilityRole="button"
          accessibilityLabel={t('studio.image.fonts.import')}
          testID="font-import"
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.fontChipText} numberOfLines={1}>{`＋ ${t('studio.image.fonts.import')}`}</Text>
        </Pressable>
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.textAlign')}</Text>
      <View style={styles.chipRow}>
        {TEXT_ALIGNS.map((a) => (
          <Chip
            key={a.key}
            label={t(`studio.image.align_${a.key}`)}
            active={(layer.textAlign ?? 'center') === a.key}
            onPress={() => commit(updateLayer<TextLayer>(doc, layer.id, { textAlign: a.key }), t('studio.image.textAlign'))}
          />
        ))}
      </View>
      <ToggleRow
        icon="text"
        label={t('studio.image.italic')}
        value={layer.fontStyle === 'italic'}
        onValueChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { fontStyle: v ? 'italic' : 'normal' }), t('studio.image.italic'))}
      />
      <ToggleRow
        icon="albums-outline"
        label={t('studio.image.textBox')}
        value={!!layer.boxWidth}
        onValueChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { boxWidth: v ? 0.7 : undefined }), t('studio.image.textBox'))}
      />
      {layer.boxWidth ? (
        <Slider
          label={t('studio.image.textBoxWidth')}
          value={layer.boxWidth}
          min={0.1}
          max={1}
          onChange={(boxWidth) => commit(updateLayer<TextLayer>(doc, layer.id, { boxWidth }), 'text-box')}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ) : null}
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
      {/* 🛤️ szöveg görbe mentén (text-on-path) — a render SVG textPath-tal égeti */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.textPath', { defaultValue: 'Szöveg görbén' })}</Text>
      <View style={styles.chipRow}>
        {(['none', 'arc', 'valley', 'wave', 'circle'] as const).map((s) => (
          <Chip
            key={s}
            label={t(`studio.image.textPathShape.${s}`, { defaultValue: s })}
            active={(layer.textPath?.shape ?? 'none') === s}
            onPress={() =>
              commit(
                updateLayer<TextLayer>(doc, layer.id, {
                  textPath: s === 'none' ? undefined : { shape: s as TextPath['shape'], curve: layer.textPath?.curve ?? 0.5 },
                })
              )
            }
          />
        ))}
      </View>
      {layer.textPath ? (
        <Slider
          label={t('studio.image.textPathCurve', { defaultValue: 'Görbület' })}
          value={layer.textPath.curve}
          min={0}
          max={1}
          onChange={(v) =>
            commit(updateLayer<TextLayer>(doc, layer.id, { textPath: { shape: layer.textPath?.shape ?? 'arc', curve: v } }))
          }
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ) : null}
    </>
  );
}

const textStyles = StyleSheet.create({
  fontChip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  fontChipActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}22` },
  fontChipText: { color: palette.text, fontSize: 15 },
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
});
const styles = { ...inspectorStyles, ...textStyles };
