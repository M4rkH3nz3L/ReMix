import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { updateLayer } from '@/lib/imageDoc';
import {
  DEVELOP_GROUPS,
  clampDevelop,
  isNeutralDevelop,
  neutralDevelop,
  summarizeDevelop,
  type DevelopGroup,
  type PhotoDevelop,
} from '@/lib/photoDevelop';
import type { ImageDoc, PhotoLayer } from '@/types/project';

/** egy csúszka-mező: base (ClipAdjust) VAGY detail (DetailParams) kulcs + tartomány + címke */
interface DevField {
  group: DevelopGroup;
  /** `base` → ClipAdjust-mező; `detail` → DetailParams-mező */
  bucket: 'base' | 'detail';
  key: string;
  min: number;
  max: number;
  labelKey: string;
}

/**
 * 📸 A develop-csúszkák — csoportonként (tone/color/detail/lens), a `photoDevelop.ts`
 * `GROUP_KEYS`-ével AZONOS tagolásban; a tartományok a mag `BASE_RANGES`/`DETAIL_RANGES`-éből.
 * (A görbe/3-way/lut a dúsabb AdjustStackSheet-é marad — ez a gyors, csúszka-first előhívás.)
 */
const FIELDS: DevField[] = [
  // ── tónus ──────────────────────────────────────────────────────────────
  { group: 'tone', bucket: 'base', key: 'exposure', min: -1, max: 1, labelKey: 'panels.adjust.adjust_exposure' },
  { group: 'tone', bucket: 'base', key: 'contrast', min: -0.4, max: 0.4, labelKey: 'panels.adjust.adjust_contrast' },
  { group: 'tone', bucket: 'base', key: 'highlights', min: -1, max: 1, labelKey: 'panels.adjust.adjust_highlights' },
  { group: 'tone', bucket: 'base', key: 'shadows', min: -1, max: 1, labelKey: 'panels.adjust.adjust_shadows' },
  { group: 'tone', bucket: 'base', key: 'whites', min: -1, max: 1, labelKey: 'panels.adjust.adjust_whites' },
  { group: 'tone', bucket: 'base', key: 'blacks', min: -1, max: 1, labelKey: 'panels.adjust.adjust_blacks' },
  { group: 'tone', bucket: 'detail', key: 'clarity', min: -1, max: 1, labelKey: 'studio.image.develop.clarity' },
  { group: 'tone', bucket: 'detail', key: 'dehaze', min: -1, max: 1, labelKey: 'studio.image.develop.dehaze' },
  // ── szín ───────────────────────────────────────────────────────────────
  { group: 'color', bucket: 'base', key: 'temperature', min: -0.3, max: 0.3, labelKey: 'panels.adjust.adjust_temperature' },
  { group: 'color', bucket: 'base', key: 'tint', min: -0.3, max: 0.3, labelKey: 'panels.adjust.adjust_tint' },
  { group: 'color', bucket: 'base', key: 'saturation', min: -1, max: 1, labelKey: 'panels.adjust.adjust_saturation' },
  { group: 'color', bucket: 'base', key: 'vibrance', min: -1, max: 1, labelKey: 'panels.adjust.adjust_vibrance' },
  { group: 'color', bucket: 'base', key: 'hue', min: -1, max: 1, labelKey: 'studio.image.develop.hue' },
  { group: 'color', bucket: 'base', key: 'hslSaturation', min: -1, max: 1, labelKey: 'studio.image.develop.hslSaturation' },
  { group: 'color', bucket: 'base', key: 'hslLuminance', min: -1, max: 1, labelKey: 'studio.image.develop.hslLuminance' },
  // ── detail ─────────────────────────────────────────────────────────────
  { group: 'detail', bucket: 'detail', key: 'texture', min: -1, max: 1, labelKey: 'studio.image.develop.texture' },
  { group: 'detail', bucket: 'detail', key: 'sharpness', min: 0, max: 1, labelKey: 'studio.image.develop.sharpness' },
  { group: 'detail', bucket: 'detail', key: 'noiseReduction', min: 0, max: 1, labelKey: 'studio.image.develop.noiseReduction' },
  // ── lencse ─────────────────────────────────────────────────────────────
  { group: 'lens', bucket: 'base', key: 'vignette', min: 0, max: 1, labelKey: 'panels.adjust.adjust_vignette' },
  { group: 'lens', bucket: 'detail', key: 'chromaticAberration', min: 0, max: 1, labelKey: 'studio.image.develop.chromaticAberration' },
  { group: 'lens', bucket: 'detail', key: 'lensDistortion', min: -1, max: 1, labelKey: 'studio.image.develop.lensDistortion' },
];

const GROUP_META: Record<DevelopGroup, { icon: keyof typeof Ionicons.glyphMap; titleKey: string }> = {
  tone: { icon: 'sunny-outline', titleKey: 'studio.image.develop.groupTone' },
  color: { icon: 'color-palette-outline', titleKey: 'studio.image.develop.groupColor' },
  detail: { icon: 'scan-outline', titleKey: 'studio.image.develop.groupDetail' },
  lens: { icon: 'camera-outline', titleKey: 'studio.image.develop.groupLens' },
};

/**
 * 📸 RAW-DEVELOP lap (S-PHOTO — PIXEL 01): non-destruktív fotó-előhívás a kiválasztott
 * fotó-rétegre. Csoportonként (tónus/szín/detail/lencse) csúszkák a `PhotoDevelop` mezőire;
 * minden írás a KÉP-command-buson megy (`commit` + `updateLayer` → `develop`), a `clampDevelop`
 * a mentés előtt a tartományba vág. Reset a `neutralDevelop()`-pal; az aktív paramétereket a
 * `summarizeDevelop` összegzi. A PONTOS hatás a renderben ég be (`server/imagedoc.js` develop-lánc,
 * contract-lockkal a `developToFilterPlan`-hez); az előnézet a base-korrekciót közelíti.
 */
export function DevelopSheet({
  doc,
  layer,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  layer: PhotoLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dev: PhotoDevelop = layer.develop ?? neutralDevelop();

  // 📸 egy mező írása: a develop immutábilis frissítése → clamp → command-bus (undo)
  const setField = (f: DevField, v: number) => {
    const next: PhotoDevelop = {
      base: { ...dev.base },
      detail: { ...dev.detail },
    };
    if (f.bucket === 'base') {
      (next.base as Record<string, number>)[f.key] = v;
    } else {
      (next.detail as Record<string, number>)[f.key] = v;
    }
    const clamped = clampDevelop(next);
    commit(
      updateLayer<PhotoLayer>(doc, layer.id, { develop: isNeutralDevelop(clamped) ? undefined : clamped }),
      'develop'
    );
  };

  const value = (f: DevField): number => {
    const bucket = f.bucket === 'base' ? dev.base : dev.detail;
    const v = (bucket as Record<string, unknown>)[f.key];
    return typeof v === 'number' ? v : 0;
  };

  const active = summarizeDevelop(dev);

  return (
    <StudioSheet
      title={t('studio.image.develop.title')}
      icon="aperture-outline"
      onClose={onClose}
      footer={
        !isNeutralDevelop(dev) ? (
          <Pressable
            style={styles.reset}
            onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { develop: undefined }), 'develop-reset')}
          >
            <Ionicons name="refresh-outline" size={15} color={palette.text} />
            <Text style={styles.resetText}>{t('studio.image.develop.reset')}</Text>
          </Pressable>
        ) : undefined
      }
    >
      {/* 📋 összegzés: az aktív (nem-neutrális) paraméterek száma */}
      <Text style={styles.summary}>
        {active.length > 0
          ? t('studio.image.develop.activeCount', { count: active.length })
          : t('studio.image.develop.neutral')}
      </Text>

      {DEVELOP_GROUPS.map((group) => {
        const meta = GROUP_META[group];
        const fields = FIELDS.filter((f) => f.group === group);
        return (
          <View key={group} style={styles.group}>
            <View style={styles.groupHead}>
              <Ionicons name={meta.icon} size={15} color={palette.accent} />
              <Text style={styles.groupTitle}>{t(meta.titleKey)}</Text>
            </View>
            {fields.map((f) => (
              <Slider
                key={`${f.bucket}.${f.key}`}
                label={t(f.labelKey, { defaultValue: f.key })}
                value={value(f)}
                min={f.min}
                max={f.max}
                onChange={(v) => setField(f, v)}
                format={(v) => v.toFixed(2)}
              />
            ))}
          </View>
        );
      })}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingBottom: 4,
  },
  group: {
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  groupTitle: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  reset: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  resetText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
