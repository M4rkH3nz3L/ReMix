import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import {
  BG_SWATCHES,
  CANVAS_PRESETS,
  clampDim,
  effectiveCanvas,
  isHexColor,
} from '@/lib/canvasPresets';
import { docBackground, setBackground } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import type { ImageDoc } from '@/types/project';

/**
 * 🖼️ Vászon-beállítás lap — a kép-editor „Új dokumentum” mezőivel AZONOS
 * vezérlők a MÁR létező dokumentumhoz: szabad W×H (px) + presetek + csere,
 * dokumentum-típus (pixel/vektor), háttér (szín / átlátszó / egyedi hex).
 * Egy „Alkalmaz” = EGY undo-lépés (UPSERT_IMAGE_DOC a `commit`-on át).
 */
export function CanvasSheet({
  doc,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const init = effectiveCanvas(doc);
  const [w, setW] = useState(String(init.width));
  const [h, setH] = useState(String(init.height));
  const [format, setFormat] = useState<'raster' | 'vector'>(doc.format ?? 'raster');
  const [bg, setBg] = useState<string>(docBackground(doc));

  const apply = () => {
    const width = clampDim(w);
    const height = clampDim(h);
    const next = setBackground(
      { ...doc, width, height, format, renderedUri: undefined },
      bg === 'transparent' || isHexColor(bg) ? bg : BG_SWATCHES[0],
      () => makeId('lyr')
    );
    commit(next, t('studio.image.undoCanvas'));
    onClose();
  };

  return (
    <StudioSheet
      title={t('studio.image.canvasTitle')}
      icon="resize"
      onClose={onClose}
      footer={
        <Pressable style={styles.apply} onPress={apply}>
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.applyText}>{t('common.apply')}</Text>
        </Pressable>
      }
    >
      <Text style={styles.section}>{t('home.formatLabel')}</Text>
      <View style={styles.row}>
        <Chip label={t('home.formatRaster')} active={format === 'raster'} onPress={() => setFormat('raster')} />
        <Chip label={t('home.formatVector')} active={format === 'vector'} onPress={() => setFormat('vector')} />
      </View>

      <Text style={styles.section}>{t('home.canvasLabel')}</Text>
      <View style={styles.row}>
        {CANVAS_PRESETS.map((p) => (
          <Chip
            key={p.label}
            label={p.label}
            active={clampDim(w) === p.w && clampDim(h) === p.h}
            onPress={() => {
              setW(String(p.w));
              setH(String(p.h));
            }}
          />
        ))}
      </View>
      <View style={styles.dimRow}>
        <View style={styles.dimField}>
          <Text style={styles.dimLabel}>{t('home.widthLabel')}</Text>
          <TextInput
            value={w}
            onChangeText={(v) => setW(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            style={styles.input}
            placeholderTextColor={palette.textDim}
          />
        </View>
        <Pressable
          onPress={() => {
            setW(h);
            setH(w);
          }}
          style={styles.swapBtn}
          accessibilityRole="button"
          accessibilityLabel={t('home.swapDims')}
        >
          <Ionicons name="swap-horizontal" size={18} color={palette.accent} />
        </Pressable>
        <View style={styles.dimField}>
          <Text style={styles.dimLabel}>{t('home.heightLabel')}</Text>
          <TextInput
            value={h}
            onChangeText={(v) => setH(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            style={styles.input}
            placeholderTextColor={palette.textDim}
          />
        </View>
      </View>
      <Text style={styles.hint}>{t('home.canvasSize', { width: clampDim(w), height: clampDim(h) })}</Text>

      <Text style={styles.section}>{t('home.backgroundLabel')}</Text>
      <View style={styles.bgRow}>
        {BG_SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setBg(c)}
            accessibilityRole="button"
            accessibilityLabel={c}
            style={[styles.swatch, { backgroundColor: c }, bg === c && styles.swatchActive]}
          />
        ))}
        <Pressable
          onPress={() => setBg('transparent')}
          accessibilityRole="button"
          accessibilityLabel={t('home.bgTransparent')}
          style={[styles.swatch, styles.swatchTransparent, bg === 'transparent' && styles.swatchActive]}
        >
          <Ionicons name="ban-outline" size={18} color={palette.textDim} />
        </Pressable>
      </View>
      <TextInput
        value={bg === 'transparent' ? '' : bg}
        onChangeText={setBg}
        placeholder={t('home.bgHexPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  section: { color: palette.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  dimRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  dimField: { flex: 1, gap: 4 },
  dimLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  swapBtn: {
    width: 42,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  hint: { color: palette.textDim, fontSize: 11 },
  bgRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  swatch: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: palette.border },
  swatchActive: { borderWidth: 3, borderColor: palette.accent },
  swatchTransparent: { backgroundColor: palette.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  apply: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: palette.accent,
  },
  applyText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
