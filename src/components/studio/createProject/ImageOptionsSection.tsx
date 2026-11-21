import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/studio/createProject/createProjectStyles';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { BG_SWATCHES, CANVAS_PRESETS, clampDim } from '@/lib/canvasPresets';
import { bgHexValue, digitsOnly, isCanvasPresetActive } from '@/lib/createProjectModalOps';

/** 🖼️ KÉP-projekt: dokumentum-típus + szabad vászon W×H + háttér (kép-editor) — a CreateProjectModal.tsx-ből kiemelve */
export function ImageOptionsSection(props: {
  imgW: string;
  setImgW: (v: string) => void;
  imgH: string;
  setImgH: (v: string) => void;
  imgFormat: 'raster' | 'vector';
  setImgFormat: (f: 'raster' | 'vector') => void;
  bg: string;
  setBg: (v: string) => void;
}) {
  const { t } = useTranslation();
  const { imgW, setImgW, imgH, setImgH, imgFormat, setImgFormat, bg, setBg } = props;
  return (
    <>
      <Text style={styles.fieldLabel}>{t('home.formatLabel')}</Text>
      <View style={styles.aspectRow}>
        <Chip
          label={t('home.formatRaster')}
          active={imgFormat === 'raster'}
          onPress={() => setImgFormat('raster')}
        />
        <Chip
          label={t('home.formatVector')}
          active={imgFormat === 'vector'}
          onPress={() => setImgFormat('vector')}
        />
      </View>

      <Text style={styles.fieldLabel}>{t('home.canvasLabel')}</Text>
      <View style={styles.aspectRow}>
        {CANVAS_PRESETS.map((p) => (
          <Chip
            key={p.label}
            label={p.label}
            active={isCanvasPresetActive(imgW, imgH, p)}
            onPress={() => {
              setImgW(String(p.w));
              setImgH(String(p.h));
            }}
          />
        ))}
      </View>
      <View style={styles.dimRow}>
        <View style={styles.dimField}>
          <Text style={styles.dimLabel}>{t('home.widthLabel')}</Text>
          <TextInput
            value={imgW}
            onChangeText={(v) => setImgW(digitsOnly(v))}
            keyboardType="number-pad"
            style={styles.input}
            placeholder="1080"
            placeholderTextColor={palette.textDim}
          />
        </View>
        <Pressable
          onPress={() => {
            setImgW(imgH);
            setImgH(imgW);
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
            value={imgH}
            onChangeText={(v) => setImgH(digitsOnly(v))}
            keyboardType="number-pad"
            style={styles.input}
            placeholder="1080"
            placeholderTextColor={palette.textDim}
          />
        </View>
      </View>
      <Text style={styles.seoHint}>
        {t('home.canvasSize', { width: clampDim(imgW), height: clampDim(imgH) })}
      </Text>

      <Text style={styles.fieldLabel}>{t('home.backgroundLabel')}</Text>
      <View style={styles.bgRow}>
        {BG_SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setBg(c)}
            accessibilityRole="button"
            accessibilityLabel={c}
            style={[
              styles.swatch,
              { backgroundColor: c },
              bg === c && styles.swatchActive,
            ]}
          />
        ))}
        <Pressable
          onPress={() => setBg('transparent')}
          accessibilityRole="button"
          accessibilityLabel={t('home.bgTransparent')}
          style={[
            styles.swatch,
            styles.swatchTransparent,
            bg === 'transparent' && styles.swatchActive,
          ]}
        >
          <Ionicons name="ban-outline" size={18} color={palette.textDim} />
        </Pressable>
      </View>
      <TextInput
        value={bgHexValue(bg)}
        onChangeText={setBg}
        placeholder={t('home.bgHexPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </>
  );
}
