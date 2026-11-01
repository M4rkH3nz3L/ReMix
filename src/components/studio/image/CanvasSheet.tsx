import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { GRADES as GRADE_PRESETS } from '@/constants/grades';
import { palette } from '@/constants/editor';
import {
  BG_SWATCHES,
  CANVAS_PRESETS,
  clampDim,
  effectiveCanvas,
  isHexColor,
} from '@/lib/canvasPresets';
import { type Anchor, flipCanvasDoc, resampleDoc, resizeCanvasDoc, rotateCanvasDoc } from '@/lib/imageCanvasOps';
import { docBackground, setBackground } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import type { ClipAdjust, GradeId, ImageDoc } from '@/types/project';

function TransformBtn({
  icon,
  label,
  flip,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  flip?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.transformBtn} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={palette.text} style={flip ? { transform: [{ scaleX: -1 }] } : undefined} />
    </Pressable>
  );
}

/**
 * 🖼️ Vászon-beállítás lap — a kép-editor „Új dokumentum” mezőivel AZONOS
 * vezérlők a MÁR létező dokumentumhoz: szabad W×H (px) + presetek + csere,
 * dokumentum-típus (pixel/vektor), háttér (szín / átlátszó / egyedi hex).
 * Egy „Alkalmaz” = EGY undo-lépés (UPSERT_IMAGE_DOC a `commit`-on át).
 */
export function CanvasSheet({
  doc,
  commit,
  onVariant,
  onClose,
}: {
  doc: ImageDoc;
  commit: (next: ImageDoc, label?: string) => void;
  /** ugyanaz a terv más méretben, új lapon */
  onVariant?: (width: number, height: number, label: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const init = effectiveCanvas(doc);
  const [w, setW] = useState(String(init.width));
  const [h, setH] = useState(String(init.height));
  const [format, setFormat] = useState<'raster' | 'vector'>(doc.format ?? 'raster');
  const [bg, setBg] = useState<string>(docBackground(doc));
  const [grain, setGrain] = useState(doc.grain ?? 0);
  const [vignette, setVignette] = useState(doc.vignette ?? 0);
  const [grade, setGrade] = useState<GradeId>(doc.grade ?? 'none');
  const [adjust, setAdjust] = useState<ClipAdjust>(doc.adjust ?? {});
  const setAdj = (patch: Partial<ClipAdjust>) => setAdjust((a) => ({ ...a, ...patch }));
  const adjNeutral =
    !Math.abs(adjust.exposure ?? 0) && !Math.abs(adjust.contrast ?? 0) && !Math.abs(adjust.saturation ?? 0);

  // 📐 „Vászon": a keret változik, a tartalom pixelre marad; „Képméret": minden skálázódik
  const [resizeMode, setResizeMode] = useState<'canvas' | 'resample'>('canvas');
  const [anchor, setAnchor] = useState<Anchor>({ x: 0.5, y: 0.5 });
  const transform = (next: ImageDoc, label: string) => {
    commit(next, label);
    onClose();
  };

  const apply = () => {
    const width = clampDim(w);
    const height = clampDim(h);
    const sized =
      width === init.width && height === init.height
        ? doc
        : resizeMode === 'canvas'
          ? resizeCanvasDoc(doc, width, height, anchor)
          : resampleDoc(doc, width, height);
    const next = setBackground(
      {
        ...sized,
        format,
        grain: grain > 0 ? grain : undefined,
        vignette: vignette > 0 ? vignette : undefined,
        grade: grade === 'none' ? undefined : grade,
        adjust: adjNeutral ? undefined : adjust,
        renderedUri: undefined,
      },
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
      <Text style={styles.section}>{t('studio.image.canvasTransform')}</Text>
      <View style={styles.row}>
        <TransformBtn icon="refresh-outline" flip label={t('studio.image.rotateLeft')} onPress={() => transform(rotateCanvasDoc(doc, -90), t('studio.image.rotateLeft'))} />
        <TransformBtn icon="refresh-outline" label={t('studio.image.rotateRight')} onPress={() => transform(rotateCanvasDoc(doc, 90), t('studio.image.rotateRight'))} />
        <TransformBtn icon="swap-horizontal" label={t('studio.image.flipCanvasH')} onPress={() => transform(flipCanvasDoc(doc, 'horizontal'), t('studio.image.flipCanvasH'))} />
        <TransformBtn icon="swap-vertical" label={t('studio.image.flipCanvasV')} onPress={() => transform(flipCanvasDoc(doc, 'vertical'), t('studio.image.flipCanvasV'))} />
      </View>

      <Text style={styles.section}>{t('home.formatLabel')}</Text>
      <View style={styles.row}>
        <Chip label={t('home.formatRaster')} active={format === 'raster'} onPress={() => setFormat('raster')} />
        <Chip label={t('home.formatVector')} active={format === 'vector'} onPress={() => setFormat('vector')} />
      </View>

      {onVariant ? (
        <>
          <Text style={styles.section}>{t('studio.image.variant.title')}</Text>
          <View style={styles.row}>
            {CANVAS_PRESETS.map((p) => (
              <Chip
                key={p.label}
                label={p.label}
                active={false}
                onPress={() => {
                  onVariant(p.w, p.h, p.label);
                  onClose();
                }}
              />
            ))}
          </View>
        </>
      ) : null}

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
      <View style={styles.row}>
        <Chip label={t('studio.image.resizeCanvas')} active={resizeMode === 'canvas'} onPress={() => setResizeMode('canvas')} />
        <Chip label={t('studio.image.resizeImage')} active={resizeMode === 'resample'} onPress={() => setResizeMode('resample')} />
      </View>
      {resizeMode === 'canvas' ? (
        <View style={styles.anchorGrid}>
          {[0, 0.5, 1].flatMap((y) =>
            [0, 0.5, 1].map((x) => (
              <Pressable
                key={`${x}-${y}`}
                onPress={() => setAnchor({ x, y })}
                style={[styles.anchorCell, anchor.x === x && anchor.y === y ? styles.anchorActive : null]}
                accessibilityRole="button"
                accessibilityLabel={t('studio.image.anchorCell', { x: x * 100, y: y * 100 })}
                accessibilityState={{ selected: anchor.x === x && anchor.y === y }}
              />
            ))
          )}
        </View>
      ) : null}

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

      {/* 🎞️ dokumentum-szintű filmszemcse (a teljes kész képre) */}
      <Slider label={t('studio.image.grain', { defaultValue: 'Filmszemcse' })} value={grain} min={0} max={1} onChange={setGrain} format={(v) => `${Math.round(v * 100)}%`} />

      {/* 🔦 dokumentum-szintű vignetta (a sarkokat sötétíti) */}
      <Slider label={t('studio.image.vignette', { defaultValue: 'Vignetta' })} value={vignette} min={0} max={1} onChange={setVignette} format={(v) => `${Math.round(v * 100)}%`} />

      {/* 🎬 dokumentum-szintű GLOBÁLIS look (grade + korrekció) a TELJES képre */}
      <Text style={styles.section}>{t('studio.image.globalLook', { defaultValue: 'Globális look' })}</Text>
      <View style={styles.row}>
        {GRADE_PRESETS.map((g) => (
          <Chip
            key={g.id}
            label={t(g.label, { defaultValue: g.id })}
            active={grade === g.id}
            onPress={() => setGrade(g.id)}
          />
        ))}
      </View>
      <Slider label={t('panels.adjust.adjust_exposure', { defaultValue: 'Expozíció' })} value={adjust.exposure ?? 0} min={-1} max={1} onChange={(v) => setAdj({ exposure: v })} format={(v) => v.toFixed(2)} />
      <Slider label={t('panels.adjust.adjust_contrast', { defaultValue: 'Kontraszt' })} value={adjust.contrast ?? 0} min={-0.4} max={0.4} onChange={(v) => setAdj({ contrast: v })} format={(v) => v.toFixed(2)} />
      <Slider label={t('panels.adjust.adjust_saturation', { defaultValue: 'Telítettség' })} value={adjust.saturation ?? 0} min={-1} max={1} onChange={(v) => setAdj({ saturation: v })} format={(v) => v.toFixed(2)} />
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  transformBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorGrid: { width: 132, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  anchorCell: { width: 40, height: 40, borderRadius: 6, borderWidth: 1, borderColor: palette.border },
  anchorActive: { backgroundColor: palette.accent, borderColor: palette.accent },
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
