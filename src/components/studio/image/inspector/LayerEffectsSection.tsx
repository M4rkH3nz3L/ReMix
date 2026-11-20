import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { updateLayer } from '@/lib/imageDoc';
import { INNER_DEFAULTS } from '@/lib/innerEffects';
import type { ImageDoc, ImageLayer } from '@/types/project';

import { inspectorStyles as styles } from './inspectorStyles';

/** 🌑 réteg-effektek (nem-fill rétegre): vetett árnyék, ragyogás, kontúr + a belső stílusok (fotó/forma) */
export function LayerEffectsSection({
  doc,
  layer,
  commit,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
}) {
  const { t } = useTranslation();

  // 🌑/✨ egyedi árnyék/glow — a boolean `true` alap-paraméter, az objektum az egyedi
  const dsCfg = typeof layer.dropShadow === 'object' ? layer.dropShadow : {};
  const glowCfg = typeof layer.outerGlow === 'object' ? layer.outerGlow : {};
  const setShadow = (patch: Record<string, unknown>) =>
    commit(updateLayer(doc, layer.id, { dropShadow: { ...dsCfg, ...patch } } as Partial<ImageLayer>), 'shadow');
  const setGlow = (patch: Record<string, unknown>) =>
    commit(updateLayer(doc, layer.id, { outerGlow: { ...glowCfg, ...patch } } as Partial<ImageLayer>), 'glow');

  return (
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
      {/* 🌑 egyedi árnyék (szín/eltolás/lágyság/átlátszóság) */}
      {layer.dropShadow ? (
        <>
          <ColorField
            label={t('studio.image.shadowColor', { defaultValue: 'Árnyék szín' })}
            value={dsCfg.color ?? '#000000'}
            onChange={(color) => setShadow({ color })}
          />
          <Slider label={t('studio.image.shadowDx', { defaultValue: 'Árnyék X' })} value={dsCfg.dx ?? 0.02} min={-0.1} max={0.1} onChange={(v) => setShadow({ dx: v })} format={(v) => v.toFixed(3)} />
          <Slider label={t('studio.image.shadowDy', { defaultValue: 'Árnyék Y' })} value={dsCfg.dy ?? 0.02} min={-0.1} max={0.1} onChange={(v) => setShadow({ dy: v })} format={(v) => v.toFixed(3)} />
          <Slider label={t('studio.image.shadowBlur', { defaultValue: 'Árnyék lágyság' })} value={dsCfg.blur ?? 0.012} min={0} max={0.06} onChange={(v) => setShadow({ blur: v })} format={(v) => v.toFixed(3)} />
          <Slider label={t('studio.image.shadowOpacity', { defaultValue: 'Árnyék átlátszóság' })} value={dsCfg.opacity ?? 0.5} min={0} max={1} onChange={(v) => setShadow({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      ) : null}
      {/* ✨ egyedi ragyogás (szín/méret/átlátszóság) */}
      {layer.outerGlow ? (
        <>
          <ColorField
            label={t('studio.image.glowColor', { defaultValue: 'Ragyogás szín' })}
            value={glowCfg.color ?? '#7c5cff'}
            onChange={(color) => setGlow({ color })}
          />
          <Slider label={t('studio.image.glowSize', { defaultValue: 'Ragyogás méret' })} value={glowCfg.size ?? 0.02} min={0.005} max={0.08} onChange={(v) => setGlow({ size: v })} format={(v) => v.toFixed(3)} />
          <Slider label={t('studio.image.glowOpacity', { defaultValue: 'Ragyogás erő' })} value={glowCfg.opacity ?? 0.85} min={0} max={1} onChange={(v) => setGlow({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      ) : null}
      {/* 🎨 S13: a réteg alakján BELÜLI stílusok (fotó, forma) — színátfedés, belső ragyogás, belső árnyék */}
      {layer.kind === 'photo' || layer.kind === 'shape' ? (
        <>
          <View style={styles.chipRow}>
            <Chip
              label={t('studio.image.inner.overlay')}
              active={!!layer.colorOverlay}
              onPress={() => commit(updateLayer(doc, layer.id, { colorOverlay: layer.colorOverlay ? undefined : { ...INNER_DEFAULTS.overlay, opacity: 0.6 } } as Partial<ImageLayer>), t('studio.image.inner.overlay'))}
            />
            <Chip
              label={t('studio.image.inner.glow')}
              active={!!layer.innerGlow}
              onPress={() => commit(updateLayer(doc, layer.id, { innerGlow: layer.innerGlow ? undefined : {} } as Partial<ImageLayer>), t('studio.image.inner.glow'))}
            />
            <Chip
              label={t('studio.image.inner.shadow')}
              active={!!layer.innerShadow}
              onPress={() => commit(updateLayer(doc, layer.id, { innerShadow: layer.innerShadow ? undefined : {} } as Partial<ImageLayer>), t('studio.image.inner.shadow'))}
            />
          </View>
          {layer.colorOverlay ? (
            <>
              <ColorField label={t('studio.image.inner.overlayColor')} value={layer.colorOverlay.color} onChange={(color) => commit(updateLayer(doc, layer.id, { colorOverlay: { ...layer.colorOverlay!, color } } as Partial<ImageLayer>))} />
              <Slider label={t('studio.image.inner.overlayOpacity')} value={layer.colorOverlay.opacity ?? 1} min={0} max={1} onChange={(v) => commit(updateLayer(doc, layer.id, { colorOverlay: { ...layer.colorOverlay!, opacity: v } } as Partial<ImageLayer>))} format={(v) => `${Math.round(v * 100)}%`} />
            </>
          ) : null}
          {layer.innerGlow ? (
            <>
              <ColorField label={t('studio.image.inner.glowColor')} value={layer.innerGlow.color ?? INNER_DEFAULTS.glow.color} onChange={(color) => commit(updateLayer(doc, layer.id, { innerGlow: { ...layer.innerGlow, color } } as Partial<ImageLayer>))} />
              <Slider label={t('studio.image.inner.glowSize')} value={layer.innerGlow.size ?? INNER_DEFAULTS.glow.size} min={0.004} max={0.08} onChange={(v) => commit(updateLayer(doc, layer.id, { innerGlow: { ...layer.innerGlow, size: v } } as Partial<ImageLayer>))} format={(v) => v.toFixed(3)} />
            </>
          ) : null}
          {layer.innerShadow ? (
            <>
              <ColorField label={t('studio.image.inner.shadowColor')} value={layer.innerShadow.color ?? INNER_DEFAULTS.shadow.color} onChange={(color) => commit(updateLayer(doc, layer.id, { innerShadow: { ...layer.innerShadow, color } } as Partial<ImageLayer>))} />
              <Slider label={t('studio.image.inner.shadowDistance')} value={layer.innerShadow.dy ?? INNER_DEFAULTS.shadow.dy} min={0} max={0.06} onChange={(v) => commit(updateLayer(doc, layer.id, { innerShadow: { ...layer.innerShadow, dx: v, dy: v } } as Partial<ImageLayer>))} format={(v) => v.toFixed(3)} />
              <Slider label={t('studio.image.inner.shadowBlur')} value={layer.innerShadow.blur ?? INNER_DEFAULTS.shadow.blur} min={0} max={0.06} onChange={(v) => commit(updateLayer(doc, layer.id, { innerShadow: { ...layer.innerShadow, blur: v } } as Partial<ImageLayer>))} format={(v) => v.toFixed(3)} />
            </>
          ) : null}
        </>
      ) : null}
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
  );
}
