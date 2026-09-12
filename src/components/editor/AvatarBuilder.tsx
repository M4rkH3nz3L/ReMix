import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AvatarSvg } from '@/components/AvatarSvg';
import { palette } from '@/constants/editor';
import {
  ACCESSORIES,
  BG_COLORS,
  FACES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  cycle,
  randomAvatar,
  type AvatarConfig,
} from '@/lib/avatar';

/**
 * 🧑‍🎨 Karakter-építő: a felhasználó ÖSSZERAKJA az avatart — bőrszín (teljes
 * skála), haj-szín/-forma, arc-kifejezés, kiegészítő, háttér. Élő SVG-előnézet;
 * a színek swatch-ok, a formák ◀ ▶ léptetők. „🎲" = véletlen kiindulás.
 */
export function AvatarBuilder({
  value,
  onChange,
}: {
  value: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...value, ...patch });

  // sima render-segédek (NEM komponensek) — meghívva, nem <JSX/>-ként használva
  const swatches = (colors: readonly string[], field: keyof AvatarConfig) => (
    <View style={styles.swatchRow}>
      {colors.map((col, i) => (
        <Pressable
          key={col + i}
          onPress={() => set({ [field]: i } as Partial<AvatarConfig>)}
          style={[
            styles.swatch,
            { backgroundColor: col },
            value[field] === i ? styles.swatchActive : null,
          ]}
        />
      ))}
    </View>
  );

  const stepper = (field: keyof AvatarConfig, len: number, label: string) => (
    <View style={styles.stepRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepBtns}>
        <Pressable
          hitSlop={8}
          onPress={() => set({ [field]: cycle(value[field], len, -1) } as Partial<AvatarConfig>)}
          style={styles.stepBtn}
        >
          <Ionicons name="chevron-back" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.stepValue}>
          {value[field] + 1}/{len}
        </Text>
        <Pressable
          hitSlop={8}
          onPress={() => set({ [field]: cycle(value[field], len, 1) } as Partial<AvatarConfig>)}
          style={styles.stepBtn}
        >
          <Ionicons name="chevron-forward" size={16} color={palette.text} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.previewRow}>
        <AvatarSvg config={value} size={88} />
        <Pressable onPress={() => onChange(randomAvatar())} style={styles.randomBtn} hitSlop={6}>
          <Ionicons name="dice-outline" size={18} color={palette.accent} />
          <Text style={styles.randomText}>{t('avatar.randomize')}</Text>
        </Pressable>
      </View>

      <Text style={styles.groupLabel}>{t('avatar.skin')}</Text>
      {swatches(SKIN_TONES, 'skin')}
      <Text style={styles.groupLabel}>{t('avatar.hairColor')}</Text>
      {swatches(HAIR_COLORS, 'hairColor')}
      <Text style={styles.groupLabel}>{t('avatar.background')}</Text>
      {swatches(BG_COLORS, 'bg')}

      {stepper('hair', HAIR_STYLES, t('avatar.hairStyle'))}
      {stepper('face', FACES, t('avatar.face'))}
      {stepper('accessory', ACCESSORIES, t('avatar.accessory'))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  randomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  randomText: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  groupLabel: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: palette.text },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  stepLabel: { color: palette.text, fontSize: 13 },
  stepBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  stepValue: {
    color: palette.textDim,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 28,
    textAlign: 'center',
  },
});
