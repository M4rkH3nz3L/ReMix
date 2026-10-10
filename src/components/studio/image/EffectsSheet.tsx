import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { updateLayer } from '@/lib/imageDoc';
import type { ImageDoc, ShapeLayer } from '@/types/project';

/**
 * ✨ „Effektek" lap — a kijelölt FORMA réteg réteg-effektjei egy helyen, érintő-first:
 * ragyogás (szín + méret), árnyék, körvonal (szélesség + szín). Minden vezérlő a
 * MEGLÉVŐ, a renderben is leképzett mezőkre hat (`glow`/`shadow`/`borderWidth`+`borderColor`),
 * így az előnézet ([ShapeOverlay](../../preview/ShapeOverlay.tsx) `boxShadow`/`border`) és a
 * beégetett kép (worker `filter: drop-shadow`-lánc) egyezik. A ragyogás a nem-path
 * formákon eddig CSAK a renderben látszott — a `boxShadow`-előnézettel most a vásznon is.
 *
 * Megjegyzés: a ragyogás-méret és a körvonal-szélesség a vászon MAGASSÁGÁNAK %-a
 * (ugyanaz a szabály, mint a renderben) → eszköztől független, arányos effektek.
 */
export function EffectsSheet({
  doc,
  layer,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  layer: ShapeLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const patch = (p: Partial<ShapeLayer>) =>
    commit(updateLayer<ShapeLayer>(doc, layer.id, p), t('studio.image.fx.title'));

  const glowOn = !!layer.glow;
  const glowColor = layer.glow?.color ?? layer.fill;
  const glowSize = layer.glow?.size ?? 2;
  const strokeOn = (layer.borderWidth ?? 0) > 0;

  return (
    <StudioSheet title={t('studio.image.fx.title')} icon="sparkles-outline" onClose={onClose}>
      {/* ✨ Ragyogás — szín + méret (eddig csak toggle volt a Stílus-lapon) */}
      <Text style={styles.section}>{t('studio.image.fx.glow')}</Text>
      <ToggleRow
        icon="sparkles-outline"
        label={t('studio.image.fx.glowOn')}
        value={glowOn}
        onValueChange={(v) => patch({ glow: v ? { color: glowColor, size: glowSize } : undefined })}
      />
      {glowOn ? (
        <>
          <ColorField
            label={t('studio.image.fx.glowColor')}
            value={glowColor}
            onChange={(color) => patch({ glow: { color, size: glowSize } })}
          />
          <Slider
            label={t('studio.image.fx.glowSize')}
            value={glowSize}
            min={0.5}
            max={10}
            onChange={(size) => patch({ glow: { color: glowColor, size } })}
            format={(v) => `${v.toFixed(1)}%`}
          />
        </>
      ) : null}

      {/* 🌑 Árnyék — a worker fix sziluett-követő drop-shadow-ja (be/ki) */}
      <Text style={styles.section}>{t('studio.image.fx.shadow')}</Text>
      <ToggleRow
        icon="contrast"
        label={t('studio.image.fx.shadowOn')}
        value={!!layer.shadow}
        onValueChange={(v) => patch({ shadow: v })}
      />

      {/* 🖊️ Körvonal — szélesség (0 = ki) + szín */}
      <Text style={styles.section}>{t('studio.image.fx.stroke')}</Text>
      <Slider
        label={t('studio.image.fx.strokeWidth')}
        value={layer.borderWidth ?? 0}
        min={0}
        max={2}
        onChange={(borderWidth) => patch({ borderWidth })}
        format={(v) => v.toFixed(2)}
      />
      {strokeOn ? (
        <ColorField
          label={t('studio.image.fx.strokeColor')}
          value={layer.borderColor ?? '#ffffff'}
          onChange={(borderColor) => patch({ borderColor })}
        />
      ) : null}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
});
