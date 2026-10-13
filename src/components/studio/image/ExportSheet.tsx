import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { effectiveCanvas } from '@/lib/canvasPresets';
import type { ImageDoc } from '@/types/project';

type Fmt = 'png' | 'jpg' | 'webp';

/**
 * 📤 Export-lap — a kép-dokumentum kimenete egy helyen: raszter (PNG/JPG/WebP) +
 * felbontás (1×/2×, 2160-ra sapkázva) + minőség (csak veszteséges formátumnál), a
 * vektor-SVG-export, és a „beszúrás videóba". A formátum/felbontás/minőség a
 * `/imagedoc`-nak megy (szerver-render), a parity a rasterize-lánc miatt megmarad.
 */
export function ExportSheet({
  doc,
  busy,
  pageCount = 1,
  onRaster,
  onSvg,
  onPdf,
  onVideo,
  onShareSlideshow,
  onShareCarousel,
  onClose,
}: {
  doc: ImageDoc;
  busy: boolean;
  /** a galéria lap-száma — ≥2 esetén jelenik meg a feed-megosztás (diavetítés/lapozható) */
  pageCount?: number;
  onRaster: (opts: { format: Fmt; height: number; quality: number }) => void;
  onSvg: () => void;
  onPdf: () => void;
  onVideo: () => void;
  onShareSlideshow?: () => void;
  onShareCarousel?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const base = effectiveCanvas(doc).height;
  const [format, setFormat] = useState<Fmt>('png');
  const [scale, setScale] = useState<1 | 2>(1);
  const [quality, setQuality] = useState(0.9);

  const height = Math.min(2160, Math.round(base * scale));
  const lossy = format === 'jpg' || format === 'webp';
  const hint = format === 'png' ? t('studio.image.export.hintPng') : format === 'jpg' ? t('studio.image.export.hintJpg') : t('studio.image.export.hintWebp');

  return (
    <StudioSheet title={t('studio.export')} icon="download-outline" onClose={onClose}>
      <Text style={styles.section}>{t('studio.image.export.formatLabel')}</Text>
      <View style={styles.row}>
        <Chip label="PNG" active={format === 'png'} onPress={() => setFormat('png')} />
        <Chip label="JPG" active={format === 'jpg'} onPress={() => setFormat('jpg')} />
        <Chip label="WebP" active={format === 'webp'} onPress={() => setFormat('webp')} />
      </View>
      <Text style={styles.hint}>{hint}</Text>

      <Text style={styles.section}>{t('studio.image.export.resolutionLabel')}</Text>
      <View style={styles.row}>
        <Chip label={`1× · ${Math.min(2160, base)}px`} active={scale === 1} onPress={() => setScale(1)} />
        <Chip label={`2× · ${Math.min(2160, base * 2)}px`} active={scale === 2} onPress={() => setScale(2)} />
      </View>

      {lossy ? (
        <Slider
          label={t('studio.image.export.qualityLabel')}
          value={quality}
          min={0.3}
          max={1}
          onChange={setQuality}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ) : null}

      <Pressable
        style={[styles.primary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          onRaster({ format, height, quality });
          onClose();
        }}
      >
        <Ionicons name="download-outline" size={16} color="#fff" />
        <Text style={styles.primaryText}>{t('studio.image.export.run')}</Text>
      </Pressable>
      <Pressable
        style={[styles.secondary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          onSvg();
          onClose();
        }}
      >
        <Ionicons name="color-wand-outline" size={16} color={palette.text} />
        <Text style={styles.secondaryText}>{t('studio.image.exportSvg')}</Text>
      </Pressable>
      <Pressable
        style={[styles.secondary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          onPdf();
          onClose();
        }}
      >
        <Ionicons name="document-outline" size={16} color={palette.text} />
        <Text style={styles.secondaryText}>{t('studio.image.exportPdf')}</Text>
      </Pressable>
      <Pressable
        style={[styles.secondary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          onVideo();
          onClose();
        }}
      >
        <Ionicons name="film-outline" size={16} color={palette.text} />
        <Text style={styles.secondaryText}>{t('studio.image.exportToVideo')}</Text>
      </Pressable>

      {/* 🖼️➡️📲 feed-megosztás: több lap → diavetítés-videó VAGY lapozható kép-poszt */}
      {pageCount >= 2 && (onShareSlideshow || onShareCarousel) ? (
        <>
          <Text style={[styles.section, { marginTop: 10 }]}>
            {t('studio.image.shareFeed.label', { defaultValue: 'Megosztás a feedbe' })}
          </Text>
          {onShareSlideshow ? (
            <Pressable
              style={[styles.secondary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => {
                onShareSlideshow();
                onClose();
              }}
            >
              <Ionicons name="play-circle-outline" size={16} color={palette.text} />
              <Text style={styles.secondaryText}>
                {t('studio.image.shareFeed.slideshow', { defaultValue: 'Diavetítésként (videó)' })}
              </Text>
            </Pressable>
          ) : null}
          {onShareCarousel ? (
            <Pressable
              style={[styles.secondary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => {
                onShareCarousel();
                onClose();
              }}
            >
              <Ionicons name="albums-outline" size={16} color={palette.text} />
              <Text style={styles.secondaryText}>
                {t('studio.image.shareFeed.carousel', { defaultValue: 'Lapozhatóként (carousel)' })}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { color: palette.textDim, fontSize: 12, marginTop: -4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 6,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingVertical: 12,
  },
  secondaryText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
