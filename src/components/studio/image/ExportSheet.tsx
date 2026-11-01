import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { customExportSize, estimateExportBytes, exportSize, formatBytes } from '@/lib/imageExport';
import { logCaught } from '@/lib/logCaught';
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
  canPsd = true,
  onRaster,
  onPack,
  onSvg,
  onPdf,
  onPsd,
  onVideo,
  onShareSlideshow,
  onShareCarousel,
  onClose,
}: {
  doc: ImageDoc;
  busy: boolean;
  /** a galéria lap-száma — ≥2 esetén jelenik meg a feed-megosztás (diavetítés/lapozható) */
  pageCount?: number;
  /** 🔒 PSD-export Pro-kapu: false → a gomb letiltva (upsell), true → engedélyezett */
  canPsd?: boolean;
  onRaster: (opts: { format: Fmt; height: number; quality: number; target?: 'share' | 'photos' }) => void;
  onPack: (opts: { format: Fmt; quality: number }) => void;
  onSvg: () => void;
  onPdf: () => void;
  /** 🖼️ réteges .psd export (worker, réteg-megőrzés) — Pro-gated */
  onPsd: () => void;
  onVideo: () => void;
  onShareSlideshow?: () => void;
  onShareCarousel?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const size1 = exportSize(doc, 1);
  const size2 = exportSize(doc, 2);
  const [format, setFormat] = useState<Fmt>('png');
  const [scale, setScale] = useState<1 | 2 | 'custom'>(1);
  const [customHeight, setCustomHeight] = useState(String(size1.height));
  const [quality, setQuality] = useState(0.9);

  const chosen = scale === 'custom' ? customExportSize(doc, Number(customHeight)) : scale === 2 ? size2 : size1;
  const { height } = chosen;
  const photos = useMemo(() => doc.layers.flatMap((l) => (l.kind === 'photo' ? [l.uri] : [])), [doc.layers]);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void import('@/components/studio/image/exportEstimate')
        .then((m) => m.photoBytesPerPixel(photos, format, quality))
        .then((v) => alive && setMeasured(v))
        .catch((caught: unknown) => logCaught('components/studio/image/ExportSheet.tsx:estimate', caught));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [photos, format, quality]);
  const pixels = chosen.width * chosen.height;
  const estimate = formatBytes(measured != null ? pixels * measured : estimateExportBytes(pixels, format, format === 'png' ? 1 : quality, photos.length > 0));
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
        <Chip label={`1× · ${size1.width}×${size1.height}`} active={scale === 1} onPress={() => setScale(1)} />
        <Chip label={`2× · ${size2.width}×${size2.height}`} active={scale === 2} onPress={() => setScale(2)} />
        <Chip label={t('studio.image.export.custom')} active={scale === 'custom'} onPress={() => setScale('custom')} />
      </View>
      {scale === 'custom' ? (
        <View style={styles.customRow}>
          <Text style={styles.hint}>{t('studio.image.export.customHeight')}</Text>
          <TextInput
            value={customHeight}
            onChangeText={setCustomHeight}
            keyboardType="number-pad"
            style={styles.input}
            accessibilityLabel={t('studio.image.export.customHeight')}
          />
          <Text style={styles.hint}>{`${chosen.width}×${chosen.height}`}</Text>
        </View>
      ) : null}

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

      <Text style={styles.hint}>{t('studio.image.export.estimate', { size: estimate })}</Text>

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
          onRaster({ format, height, quality, target: 'photos' });
          onClose();
        }}
      >
        <Ionicons name="images-outline" size={16} color={palette.text} />
        <Text style={styles.secondaryText}>{t('studio.image.export.savePhotos')}</Text>
      </Pressable>
      <Pressable
        style={[styles.secondary, busy && styles.disabled]}
        disabled={busy}
        onPress={() => {
          onPack({ format, quality });
          onClose();
        }}
      >
        <Ionicons name="albums-outline" size={16} color={palette.text} />
        <Text style={styles.secondaryText}>{t('studio.image.export.pack')}</Text>
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
      {/* 🖼️ réteges PSD-export (worker, réteg-megőrzés) — Pro-gated; free → letiltva + upsell */}
      <Pressable
        style={[styles.secondary, (busy || !canPsd) && styles.disabled]}
        disabled={busy || !canPsd}
        onPress={() => {
          onPsd();
          onClose();
        }}
      >
        <Ionicons name="layers-outline" size={16} color={palette.text} />
        <Text style={styles.secondaryText}>{t('studio.image.exportPsd')}</Text>
        {!canPsd ? <Text style={styles.proBadge}>PRO</Text> : null}
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
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { color: palette.text, borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingHorizontal: 10, height: 36, minWidth: 80, fontWeight: '700' },
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
  proBadge: {
    color: palette.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  disabled: { opacity: 0.5 },
});
