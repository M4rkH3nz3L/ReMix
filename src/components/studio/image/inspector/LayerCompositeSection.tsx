import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { assignLayerToGroup, createGroup, updateLayer } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { BLENDS } from '@/lib/layerInspectorOps';
import type { ClipMask, ImageDoc, ImageLayer } from '@/types/project';

import { inspectorStyles as styles } from './inspectorStyles';

/** 🧩 minden rétegnél: átlátszóság, csoport (mappa), réteg-maszk (nem-fill) és keverési mód */
export function LayerCompositeSection({
  doc,
  layer,
  commit,
  onDrawMask,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onDrawMask?: (layerId: string, target: 'clip' | 'local' | 'heal' | 'paint') => void;
}) {
  const { t } = useTranslation();

  // 🎭 a kijelölt réteg maszkja (union-safe olvasás) + módosítás/törlés
  const curMask = (layer as { mask?: ClipMask }).mask;
  const setMask = (mask: ClipMask | undefined) =>
    commit(updateLayer(doc, layer.id, { mask } as Partial<ImageLayer>), 'mask');

  return (
    <>
      <Slider
        label={t('studio.image.opacity')}
        value={layer.opacity ?? 1}
        min={0.05}
        max={1}
        onChange={(v) => commit(updateLayer(doc, layer.id, { opacity: v }))}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      {/* 🗂️ csoport (mappa) — a kijelölt réteg hozzárendelése egy csoporthoz / új csoport */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.group', { defaultValue: 'Csoport' })}</Text>
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
          <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.mask', { defaultValue: 'Maszk' })}</Text>
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
            {onDrawMask && layer.kind === 'photo' ? (
              <Chip
                label={t('studio.image.maskPaint')}
                active={!!curMask?.image}
                onPress={() => onDrawMask(layer.id, 'paint')}
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
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.blendMode', { defaultValue: 'Keverési mód' })}</Text>
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
    </>
  );
}
