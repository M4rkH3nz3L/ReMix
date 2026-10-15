import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { GradientEditor } from '@/components/studio/image/GradientEditor';
import { palette } from '@/constants/editor';
import { getFilterAmount, hasFilter, IMAGE_FILTER_TYPES, setFilterAmount, toggleFilter } from '@/lib/imageFilters';
import { assignLayerToGroup, createGroup, updateLayer } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { pickCubeLut } from '@/lib/media';
import { GRADES as GRADE_PRESETS } from '@/constants/grades';
import type {
  AdjustmentImageLayer,
  BlendMode,
  ClipMask,
  FillLayer,
  GradeId,
  ImageDoc,
  ImageLayer,
  PhotoLayer,
  ShapeLayer,
  TextLayer,
  TextPath,
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
  onDrawMask,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onOpenAdjust: () => void;
  /** 🎭 szabadkézi (lasszó) maszk rajzolása a megadott rétegre — a szülő aktiválja a lasszó-módot;
   *  target: 'clip' = vágó-maszk, 'local' = kijelölés-alapú korrekció maszkja */
  onDrawMask?: (layerId: string, target: 'clip' | 'local') => void;
}) {
  const { t } = useTranslation();

  // 🎭 a kijelölt réteg maszkja (union-safe olvasás) + módosítás/törlés
  const curMask = (layer as { mask?: ClipMask }).mask;
  const setMask = (mask: ClipMask | undefined) =>
    commit(updateLayer(doc, layer.id, { mask } as Partial<ImageLayer>), 'mask');

  // 🎯 kijelölés-alapú (lokális) korrekció a fotón (grade/adjust CSAK a maszkon belül)
  const setLocal = (next: PhotoLayer['localAdjust']) =>
    commit(updateLayer<PhotoLayer>(doc, layer.id, { localAdjust: next }), 'local-adjust');

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
          {/* 🛤️ szöveg görbe mentén (text-on-path) — a render SVG textPath-tal égeti */}
          <Text style={styles.sectionLabel}>{t('studio.image.textPath', { defaultValue: 'Szöveg görbén' })}</Text>
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
      ) : null}

      {layer.kind === 'photo' ? (
        <>
          <View style={styles.chipRow}>
            <Chip
              label={t('studio.image.fitCover')}
              active={!layer.fit || layer.fit === 'cover'}
              onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'cover' }))}
            />
            <Chip
              label={t('studio.image.fitContain')}
              active={layer.fit === 'contain'}
              onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'contain' }))}
            />
            <Chip
              label={t('studio.image.fitStretch', { defaultValue: 'Nyújtás' })}
              active={layer.fit === 'stretch'}
              onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'stretch' }))}
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
          {/* 📐 perspektíva / 3D-dőlés (a render ffmpeg perspective-vel, a preview 3D rotate-tel) */}
          <Slider
            label={t('studio.image.perspectiveX', { defaultValue: 'Perspektíva ↔' })}
            value={layer.perspectiveX ?? 0}
            min={-1}
            max={1}
            onChange={(v) =>
              commit(updateLayer<PhotoLayer>(doc, layer.id, { perspectiveX: Math.abs(v) < 0.02 ? undefined : v }))
            }
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label={t('studio.image.perspectiveY', { defaultValue: 'Perspektíva ↕' })}
            value={layer.perspectiveY ?? 0}
            min={-1}
            max={1}
            onChange={(v) =>
              commit(updateLayer<PhotoLayer>(doc, layer.id, { perspectiveY: Math.abs(v) < 0.02 ? undefined : v }))
            }
            format={(v) => `${Math.round(v * 100)}%`}
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
          {/* 🎨 gradient-map (egyedi-színű duotone): sötét→shadow, világos→highlight (render geq) */}
          <Text style={styles.sectionLabel}>{t('studio.image.gradientMap', { defaultValue: 'Gradient-map (duotone)' })}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={layer.gradientMap ? t('studio.image.gmapOff', { defaultValue: 'Duotone ki' }) : t('studio.image.gmapOn', { defaultValue: 'Duotone be' })}
              active={!!layer.gradientMap}
              onPress={() =>
                commit(
                  updateLayer<PhotoLayer>(doc, layer.id, {
                    gradientMap: layer.gradientMap ? undefined : { shadow: '#0d1b3a', highlight: '#ffd27f' },
                  })
                )
              }
            />
          </View>
          {layer.gradientMap ? (
            <>
              <ColorField
                label={t('studio.image.gmapShadow', { defaultValue: 'Árnyék szín' })}
                value={layer.gradientMap.shadow}
                onChange={(shadow) =>
                  commit(updateLayer<PhotoLayer>(doc, layer.id, { gradientMap: { shadow, highlight: layer.gradientMap?.highlight ?? '#ffd27f' } }))
                }
              />
              <ColorField
                label={t('studio.image.gmapHighlight', { defaultValue: 'Világos szín' })}
                value={layer.gradientMap.highlight}
                onChange={(highlight) =>
                  commit(updateLayer<PhotoLayer>(doc, layer.id, { gradientMap: { shadow: layer.gradientMap?.shadow ?? '#0d1b3a', highlight } }))
                }
              />
            </>
          ) : null}
          {/* 🎯 kijelölés-alapú (lokális) korrekció: grade/adjust CSAK a maszkon belül (maskedmerge) */}
          <Text style={styles.sectionLabel}>{t('studio.image.localAdjust', { defaultValue: 'Kijelölés-alapú korrekció' })}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={t('studio.image.maskNone', { defaultValue: 'Nincs' })}
              active={!layer.localAdjust}
              onPress={() => (layer.localAdjust ? setLocal(undefined) : undefined)}
            />
            <Chip
              label={t('studio.image.localOn', { defaultValue: 'Be' })}
              active={!!layer.localAdjust}
              onPress={() =>
                layer.localAdjust
                  ? undefined
                  : setLocal({ mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.6, h: 0.6, feather: 0.05 } })
              }
            />
          </View>
          {layer.localAdjust ? (
            <>
              <View style={styles.chipRow}>
                <Chip label={t('studio.image.maskEllipse', { defaultValue: 'Ellipszis' })} active={layer.localAdjust.mask.shape === 'ellipse'} onPress={() => setLocal({ ...layer.localAdjust!, mask: { ...layer.localAdjust!.mask, shape: 'ellipse' } })} />
                <Chip label={t('studio.image.maskRect', { defaultValue: 'Téglalap' })} active={layer.localAdjust.mask.shape === 'rectangle'} onPress={() => setLocal({ ...layer.localAdjust!, mask: { ...layer.localAdjust!.mask, shape: 'rectangle' } })} />
                {onDrawMask ? (
                  <Chip label={t('studio.image.maskLasso', { defaultValue: '✏️ Lasszó' })} active={layer.localAdjust.mask.shape === 'polygon'} onPress={() => onDrawMask(layer.id, 'local')} />
                ) : null}
              </View>
              <View style={styles.chipRow}>
                {GRADE_PRESETS.map((g) => (
                  <Chip
                    key={g.id}
                    label={t(g.label, { defaultValue: g.id })}
                    active={(layer.localAdjust?.grade ?? 'none') === g.id}
                    onPress={() => setLocal({ ...layer.localAdjust!, grade: g.id === 'none' ? undefined : (g.id as GradeId) })}
                  />
                ))}
              </View>
              <Slider label={t('panels.adjust.adjust_exposure', { defaultValue: 'Expozíció' })} value={layer.localAdjust.adjust?.exposure ?? 0} min={-1} max={1} onChange={(v) => setLocal({ ...layer.localAdjust!, adjust: { ...layer.localAdjust!.adjust, exposure: v } })} format={(v) => v.toFixed(2)} />
              <Slider label={t('panels.adjust.adjust_contrast', { defaultValue: 'Kontraszt' })} value={layer.localAdjust.adjust?.contrast ?? 0} min={-0.4} max={0.4} onChange={(v) => setLocal({ ...layer.localAdjust!, adjust: { ...layer.localAdjust!.adjust, contrast: v } })} format={(v) => v.toFixed(2)} />
              <Slider label={t('panels.adjust.adjust_saturation', { defaultValue: 'Telítettség' })} value={layer.localAdjust.adjust?.saturation ?? 0} min={-1} max={1} onChange={(v) => setLocal({ ...layer.localAdjust!, adjust: { ...layer.localAdjust!.adjust, saturation: v } })} format={(v) => v.toFixed(2)} />
              <Slider label={t('studio.image.maskFeather', { defaultValue: 'Lágy él' })} value={layer.localAdjust.mask.feather ?? 0.05} min={0} max={0.3} onChange={(v) => setLocal({ ...layer.localAdjust!, mask: { ...layer.localAdjust!.mask, feather: v } })} format={(v) => v.toFixed(2)} />
              <ToggleRow icon="contrast-outline" label={t('studio.image.maskInvert', { defaultValue: 'Invertálás' })} value={!!layer.localAdjust.mask.invert} onValueChange={(v) => setLocal({ ...layer.localAdjust!, mask: { ...layer.localAdjust!.mask, invert: v } })} />
            </>
          ) : null}
        </>
      ) : null}

      {layer.kind === 'adjust' ? (
        <>
          {/* 🎚️ korrekció-réteg: grade + globális adjust (az ALATTA lévő kompozitra hat); a maszk-szekció alább él */}
          <Text style={styles.sectionLabel}>{t('studio.image.filmLook', { defaultValue: 'Filmes look' })}</Text>
          <View style={styles.chipRow}>
            {GRADE_PRESETS.map((g) => (
              <Chip
                key={g.id}
                label={t(g.label, { defaultValue: g.id })}
                active={(layer.grade ?? 'none') === g.id}
                onPress={() => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { grade: g.id === 'none' ? undefined : (g.id as GradeId) }))}
              />
            ))}
          </View>
          <Slider label={t('panels.adjust.adjust_exposure', { defaultValue: 'Expozíció' })} value={layer.adjust?.exposure ?? 0} min={-1} max={1} onChange={(v) => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { adjust: { ...layer.adjust, exposure: v } }))} format={(v) => v.toFixed(2)} />
          <Slider label={t('panels.adjust.adjust_contrast', { defaultValue: 'Kontraszt' })} value={layer.adjust?.contrast ?? 0} min={-0.4} max={0.4} onChange={(v) => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { adjust: { ...layer.adjust, contrast: v } }))} format={(v) => v.toFixed(2)} />
          <Slider label={t('panels.adjust.adjust_saturation', { defaultValue: 'Telítettség' })} value={layer.adjust?.saturation ?? 0} min={-1} max={1} onChange={(v) => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { adjust: { ...layer.adjust, saturation: v } }))} format={(v) => v.toFixed(2)} />
          <Text style={styles.hintText}>{t('studio.image.adjustLayerHint', { defaultValue: 'A korrekció az ALATTA lévő rétegekre hat. Alább maszkolható.' })}</Text>
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
      {/* 🗂️ csoport (mappa) — a kijelölt réteg hozzárendelése egy csoporthoz / új csoport */}
      <Text style={styles.sectionLabel}>{t('studio.image.group', { defaultValue: 'Csoport' })}</Text>
      <View style={styles.chipRow}>
        <Chip
          label={t('studio.image.groupNone', { defaultValue: 'Nincs' })}
          active={!layer.groupId}
          onPress={() => (layer.groupId ? commit(assignLayerToGroup(doc, layer.id, undefined), 'group') : undefined)}
        />
        {(doc.groups ?? []).map((g) => (
          <Chip
            key={g.id}
            label={g.name}
            active={layer.groupId === g.id}
            onPress={() => commit(assignLayerToGroup(doc, layer.id, g.id), 'group')}
          />
        ))}
        <Chip
          label={t('studio.image.groupNew', { defaultValue: '➕ Új' })}
          active={false}
          onPress={() =>
            commit(
              createGroup(doc, [layer.id], makeId('grp'), t('studio.image.groupName', { defaultValue: 'Mappa {{n}}', n: (doc.groups?.length ?? 0) + 1 })),
              'group-new'
            )
          }
        />
      </View>
      {/* 🎭 réteg-maszk (szelekció/alak) — nem-fill rétegre; a render geq-vel vágja (lágy él/invert/terjesztés) */}
      {layer.kind !== 'fill' ? (
        <>
          <Text style={styles.sectionLabel}>{t('studio.image.mask', { defaultValue: 'Maszk' })}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={t('studio.image.maskNone', { defaultValue: 'Nincs' })}
              active={!curMask}
              onPress={() => (curMask ? setMask(undefined) : undefined)}
            />
            <Chip
              label={t('studio.image.maskEllipse', { defaultValue: 'Ellipszis' })}
              active={curMask?.shape === 'ellipse'}
              onPress={() => setMask({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.8, h: 0.8, feather: 0.05 })}
            />
            <Chip
              label={t('studio.image.maskRect', { defaultValue: 'Téglalap' })}
              active={curMask?.shape === 'rectangle'}
              onPress={() => setMask({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.8, h: 0.8, feather: 0.05 })}
            />
            {onDrawMask ? (
              <Chip
                label={t('studio.image.maskLasso', { defaultValue: '✏️ Lasszó' })}
                active={curMask?.shape === 'polygon'}
                onPress={() => onDrawMask(layer.id, 'clip')}
              />
            ) : null}
          </View>
          {curMask ? (
            <>
              <Slider
                label={t('studio.image.maskFeather', { defaultValue: 'Lágy él' })}
                value={curMask.feather ?? 0.05}
                min={0}
                max={0.3}
                onChange={(v) => setMask({ ...curMask, feather: v })}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label={t('studio.image.maskExpand', { defaultValue: 'Terjesztés' })}
                value={curMask.expand ?? 0}
                min={-0.3}
                max={0.3}
                onChange={(v) => setMask({ ...curMask, expand: v })}
                format={(v) => v.toFixed(2)}
              />
              <ToggleRow
                icon="contrast-outline"
                label={t('studio.image.maskInvert', { defaultValue: 'Invertálás' })}
                value={!!curMask.invert}
                onValueChange={(v) => setMask({ ...curMask, invert: v })}
              />
            </>
          ) : null}
        </>
      ) : null}
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

      {/* 🌑 vetett árnyék / ragyogás / 🖊️ kontúr — pozícionált rétegre (fotó/forma/szöveg) */}
      {layer.kind !== 'fill' ? (
        <>
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
            <Chip
              label={t('studio.image.outline', { defaultValue: 'Kontúr' })}
              active={!!layer.stroke}
              onPress={() =>
                commit(updateLayer(doc, layer.id, { stroke: layer.stroke ? undefined : { color: '#ffffff', width: 0.01 } }))
              }
            />
          </View>
          {layer.stroke ? (
            <>
              <ColorField
                label={t('studio.image.outlineColor', { defaultValue: 'Kontúr szín' })}
                value={layer.stroke.color}
                onChange={(color) =>
                  commit(updateLayer(doc, layer.id, { stroke: { color, width: layer.stroke?.width ?? 0.01 } }))
                }
              />
              <Slider
                label={t('studio.image.outlineWidth', { defaultValue: 'Kontúr vastagság' })}
                value={layer.stroke.width}
                min={0}
                max={0.05}
                onChange={(v) =>
                  commit(updateLayer(doc, layer.id, { stroke: { color: layer.stroke?.color ?? '#ffffff', width: v } }))
                }
                format={(v) => `${(v * 100).toFixed(1)}%`}
              />
            </>
          ) : null}
        </>
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
