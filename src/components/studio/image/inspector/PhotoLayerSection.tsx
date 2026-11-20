import { normalizeRotation } from '@/lib/imageLayerGeometry';
import { useTranslation } from 'react-i18next';
import { Alert, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { getFilterAmount, hasFilter, IMAGE_FILTER_TYPES, setFilterAmount, toggleFilter } from '@/lib/imageFilters';
import { clipBaseBelow } from '@/lib/imageClip';
import { STRAIGHTEN_MAX } from '@/lib/imageStraighten';
import { updateLayer } from '@/lib/imageDoc';
import { pickCubeLut } from '@/lib/media';
import { GRADES as GRADE_PRESETS } from '@/constants/grades';
import type { GradeId, ImageDoc, PhotoLayer } from '@/types/project';

import { inspectorStyles as styles } from './inspectorStyles';

/**
 * 🖼️ fotó-réteg: illesztés, vágómaszk, forgatás/kiegyenesítés/perspektíva, szűrők, look/LUT,
 * duotone, szintek, csatorna-mixer, lokális korrekció és folt-javítás
 */
export function PhotoLayerSection({
  doc,
  layer,
  commit,
  onOpenAdjust,
  onDrawMask,
}: {
  doc: ImageDoc;
  layer: PhotoLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onOpenAdjust: () => void;
  onDrawMask?: (layerId: string, target: 'clip' | 'local' | 'heal' | 'paint') => void;
}) {
  const { t } = useTranslation();

  // 🎯 kijelölés-alapú (lokális) korrekció a fotón (grade/adjust CSAK a maszkon belül)
  const setLocal = (next: PhotoLayer['localAdjust']) =>
    commit(updateLayer<PhotoLayer>(doc, layer.id, { localAdjust: next }), 'local-adjust');

  // 🎨 csatorna-mixer patch (identitás-alapról)
  const setMix = (patch: Record<string, number>) => {
    const cur = (layer as PhotoLayer).channelMix ?? { rr: 1, gg: 1, bb: 1 };
    commit(updateLayer<PhotoLayer>(doc, layer.id, { channelMix: { ...cur, ...patch } }), 'channel-mix');
  };

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
      {/* ✂️ S18: vágómaszk — a fotó az alatta lévő forma alakján belül látszik (élő kapcsolat) */}
      {(() => {
        const base = clipBaseBelow(doc, layer.id);
        const on = !!layer.clipTo && doc.layers.some((l) => l.id === layer.clipTo);
        return base || on ? (
          <View style={styles.chipRow}>
            <Chip
              label={t((on ? doc.layers.find((l) => l.id === layer.clipTo) : base)?.kind === 'text' ? 'studio.image.clipToText' : 'studio.image.clipToShape')}
              active={on}
              onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { clipTo: on ? undefined : base?.id }), t('studio.image.clipToShape'))}
            />
          </View>
        ) : (
          <Text maxFontSizeMultiplier={1.3} style={styles.hintText}>{t('studio.image.clipNeedsShape')}</Text>
        );
      })()}
      <Slider
        label={t('studio.image.rotation')}
        value={normalizeRotation(layer.rotation ?? 0)}
        min={-180}
        max={180}
        onChange={(v) =>
          commit(updateLayer<PhotoLayer>(doc, layer.id, { rotation: Math.round(v) }))
        }
        format={(v) => `${Math.round(v)}°`}
      />
      {/* 📐 S18: kiegyenesítés — a tartalom a dobozon belül fordul, üres sarok nélkül (0,1°-os lépés) */}
      <Slider
        label={t('studio.image.straighten')}
        value={layer.straighten ?? 0}
        min={-STRAIGHTEN_MAX}
        max={STRAIGHTEN_MAX}
        onChange={(v) => {
          const deg = Math.round(v * 10) / 10;
          commit(updateLayer<PhotoLayer>(doc, layer.id, { straighten: Math.abs(deg) < 0.05 ? undefined : deg }), 'straighten');
        }}
        format={(v) => `${(Math.round(v * 10) / 10).toFixed(1)}°`}
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
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.filters', { defaultValue: 'Szűrők' })}</Text>
      <View style={styles.chipRow}>
        {IMAGE_FILTER_TYPES.map((f) => (
          <Chip
            key={f.type}
            label={t(`studio.image.filterType.${f.type}`)}
            active={hasFilter(layer.filters, f.type)}
            onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { filters: toggleFilter(layer.filters, f.type) }))}
          />
        ))}
      </View>
      {IMAGE_FILTER_TYPES.filter((f) => hasFilter(layer.filters, f.type)).map((f) => (
        <Slider
          key={f.type}
          label={t(`studio.image.filterType.${f.type}`)}
          value={getFilterAmount(layer.filters, f.type)}
          min={0}
          max={1}
          onChange={(v) => commit(updateLayer<PhotoLayer>(doc, layer.id, { filters: setFilterAmount(layer.filters, f.type, v) }))}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ))}
      {/* 🎬 filmes look-presetek (LUT-szerű grade) — a videó grade-rétegével AZONOS térkép */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.filmLook', { defaultValue: 'Filmes look' })}</Text>
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
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.customLut', { defaultValue: 'Saját LUT (.cube)' })}</Text>
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
      {layer.lut ? <Text maxFontSizeMultiplier={1.3} style={styles.hintText}>{layer.lutName ?? 'LUT.cube'}</Text> : null}
      {/* 🎨 gradient-map (egyedi-színű duotone): sötét→shadow, világos→highlight (render geq) */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.gradientMap', { defaultValue: 'Gradient-map (duotone)' })}</Text>
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
      {/* 📊 szintek (levels): fekete/fehér-pont + gamma — a render lutrgb-vel remapeli */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.levels', { defaultValue: 'Szintek' })}</Text>
      <View style={styles.chipRow}>
        <Chip
          label={t('studio.image.maskNone', { defaultValue: 'Nincs' })}
          active={!layer.levels}
          onPress={() => (layer.levels ? commit(updateLayer<PhotoLayer>(doc, layer.id, { levels: undefined }), 'levels') : undefined)}
        />
        <Chip
          label={t('studio.image.localOn', { defaultValue: 'Be' })}
          active={!!layer.levels}
          onPress={() => (layer.levels ? undefined : commit(updateLayer<PhotoLayer>(doc, layer.id, { levels: { black: 0, white: 1, gamma: 1 } }), 'levels'))}
        />
      </View>
      {layer.levels ? (
        <>
          <Slider label={t('studio.image.levelsBlack', { defaultValue: 'Fekete-pont' })} value={layer.levels.black} min={0} max={0.9} onChange={(v) => commit(updateLayer<PhotoLayer>(doc, layer.id, { levels: { ...layer.levels!, black: v } }), 'levels')} format={(v) => v.toFixed(2)} />
          <Slider label={t('studio.image.levelsWhite', { defaultValue: 'Fehér-pont' })} value={layer.levels.white} min={0.1} max={1} onChange={(v) => commit(updateLayer<PhotoLayer>(doc, layer.id, { levels: { ...layer.levels!, white: v } }), 'levels')} format={(v) => v.toFixed(2)} />
          <Slider label={t('studio.image.levelsGamma', { defaultValue: 'Gamma' })} value={layer.levels.gamma} min={0.2} max={3} onChange={(v) => commit(updateLayer<PhotoLayer>(doc, layer.id, { levels: { ...layer.levels!, gamma: v } }), 'levels')} format={(v) => v.toFixed(2)} />
        </>
      ) : null}
      {/* 🎨 csatorna-mixer: a kimeneti R/G/B csatorna a bemenetek lineáris kombinációja */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.channelMix', { defaultValue: 'Csatorna-mixer' })}</Text>
      <View style={styles.chipRow}>
        <Chip label={t('studio.image.maskNone', { defaultValue: 'Nincs' })} active={!layer.channelMix} onPress={() => (layer.channelMix ? commit(updateLayer<PhotoLayer>(doc, layer.id, { channelMix: undefined }), 'channel-mix') : undefined)} />
        <Chip label={t('studio.image.localOn', { defaultValue: 'Be' })} active={!!layer.channelMix} onPress={() => (layer.channelMix ? undefined : commit(updateLayer<PhotoLayer>(doc, layer.id, { channelMix: { rr: 1, gg: 1, bb: 1 } }), 'channel-mix'))} />
      </View>
      {layer.channelMix
        ? ([['rr', 'R←R'], ['rg', 'R←G'], ['rb', 'R←B'], ['gr', 'G←R'], ['gg', 'G←G'], ['gb', 'G←B'], ['br', 'B←R'], ['bg', 'B←G'], ['bb', 'B←B']] as const).map(([k, lbl]) => (
            <Slider
              key={k}
              label={lbl}
              value={layer.channelMix?.[k] ?? (k === 'rr' || k === 'gg' || k === 'bb' ? 1 : 0)}
              min={-1}
              max={2}
              onChange={(v) => setMix({ [k]: v })}
              format={(v) => v.toFixed(2)}
            />
          ))
        : null}
      {/* 🎯 kijelölés-alapú (lokális) korrekció: grade/adjust CSAK a maszkon belül (maskedmerge) */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.localAdjust', { defaultValue: 'Kijelölés-alapú korrekció' })}</Text>
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
      {/* 🩹 folt-javítás / objektum-eltávolítás: lasszózd körbe a foltot → a render delogo-zza (bbox) */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.heal', { defaultValue: 'Folt-javítás' })}</Text>
      <View style={styles.chipRow}>
        {onDrawMask ? (
          <Chip label={t('studio.image.healAdd', { defaultValue: '✏️ Folt lasszó' })} active={false} onPress={() => onDrawMask(layer.id, 'heal')} />
        ) : null}
        {layer.heal?.length ? (
          <Chip label={t('studio.image.healClear', { defaultValue: 'Törlés' })} active={false} onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { heal: undefined }), 'heal-clear')} />
        ) : null}
      </View>
      {layer.heal?.length ? (
        <Text maxFontSizeMultiplier={1.3} style={styles.hintText}>{t('studio.image.healCount', { defaultValue: '{{n}} folt', n: layer.heal.length })}</Text>
      ) : null}
    </>
  );
}
