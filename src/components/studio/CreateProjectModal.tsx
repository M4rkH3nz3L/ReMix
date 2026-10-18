import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { aspectRatios, palette } from '@/constants/editor';
import { AUDIO_MASTER_TARGETS } from '@/lib/audioMaster';
import { BG_SWATCHES, CANVAS_PRESETS, clampDim } from '@/lib/canvasPresets';
import { creatableKinds } from '@/lib/projectKinds';
import { supportedSourceKinds, type SourceKind } from '@/lib/projectSource';
import type { Layout } from '@/hooks/useLayout';
import type { AspectRatio, Asset, AudioMasterTarget, ProjectKind } from '@/types/project';

/** 🎚️ a hang-projekt választható master-céljai (a 'custom' nem induló-beállítás). */
const AUDIO_TARGETS = AUDIO_MASTER_TARGETS.filter((tg) => tg !== 'custom');

/** 🎛️ Az „Új projekt" választója = a LÉTREHOZHATÓ (kész stúdiójú) fajták —
 *  a katalógusból (`@/lib/projectKinds`), hogy sose kínáljon félkész stúdiót. */
const STUDIO_KINDS: { id: ProjectKind; icon: keyof typeof Ionicons.glyphMap }[] = creatableKinds().map((m) => ({
  id: m.id,
  icon: `${m.icon}-outline` as keyof typeof Ionicons.glyphMap,
}));

/**
 * ➕ Az „Új projekt" alsó-sheet modal — a teljes létrehozás-űrlap: stúdió-fajta
 * választó + SEO-mezők + fajta-specifikus beállítások (videó képarány, kép W×H /
 * formátum / háttér, hang master-cél) + forrás-mappa. Tisztán prezentációs: minden
 * állapotot/akciót a szülő (useStudio) ad át — nincs saját fetch/logika.
 */
export function CreateProjectModal(props: {
  visible: boolean;
  L: Layout;
  // SEO-mezők
  name: string;
  setName: (v: string) => void;
  seoDescription: string;
  setSeoDescription: (v: string) => void;
  seoHashtags: string;
  setSeoHashtags: (v: string) => void;
  seoKeywords: string;
  setSeoKeywords: (v: string) => void;
  // fajta
  kind: ProjectKind;
  setKind: (k: ProjectKind) => void;
  // videó
  aspect: AspectRatio;
  setAspect: (a: AspectRatio) => void;
  // kép
  imgW: string;
  setImgW: (v: string) => void;
  imgH: string;
  setImgH: (v: string) => void;
  imgFormat: 'raster' | 'vector';
  setImgFormat: (f: 'raster' | 'vector') => void;
  bg: string;
  setBg: (v: string) => void;
  // hang
  audioTarget: AudioMasterTarget;
  setAudioTarget: (tg: AudioMasterTarget) => void;
  // forrás-mappa
  sources: Asset[];
  addSource: (sk: SourceKind) => void;
  removeSource: (id: string) => void;
  // gomb-állapot + akciók
  seoReady: boolean;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const {
    visible,
    L,
    name,
    setName,
    seoDescription,
    setSeoDescription,
    seoHashtags,
    setSeoHashtags,
    seoKeywords,
    setSeoKeywords,
    kind,
    setKind,
    aspect,
    setAspect,
    imgW,
    setImgW,
    imgH,
    setImgH,
    imgFormat,
    setImgFormat,
    bg,
    setBg,
    audioTarget,
    setAudioTarget,
    sources,
    addSource,
    removeSource,
    seoReady,
    onCreate,
    onCancel,
  } = props;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalGrabber} />
          <Text style={styles.modalTitle}>{t('home.newProject')}</Text>
          <ScrollView
            style={{ maxHeight: Math.round(L.height * 0.5) }}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 🎛️ a három stúdió: videó / kép / hang — ez határozza meg, melyik
                szerkesztő nyílik meg (ez a 3 együtt maga a Studio) */}
            <Text style={styles.fieldLabel}>{t('studio.chooseKind')}</Text>
            <View style={styles.kindRow}>
              {STUDIO_KINDS.map((k) => {
                const active = kind === k.id;
                return (
                  <Pressable
                    key={k.id}
                    style={[styles.kindTile, active && styles.kindTileActive]}
                    onPress={() => setKind(k.id)}
                  >
                    <Ionicons
                      name={k.icon}
                      size={24}
                      color={active ? palette.accent : palette.textDim}
                    />
                    <Text style={[styles.kindTileLabel, active && styles.kindTileLabelActive]}>
                      {t(`studio.kind.${k.id}`)}
                    </Text>
                    <Text style={styles.kindTileDesc} numberOfLines={2}>
                      {t(`studio.kindDesc.${k.id}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>{t('home.titleLabel')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('home.projectNamePlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              autoFocus
            />

            <Text style={styles.fieldLabel}>{t('home.seoSectionTitle')}</Text>
            <Text style={styles.seoHint}>{t('home.seoSectionHint')}</Text>

            <Text style={styles.fieldLabel}>{t('home.descriptionLabel')}</Text>
            <TextInput
              value={seoDescription}
              onChangeText={setSeoDescription}
              placeholder={t('home.descriptionPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={[styles.input, styles.inputMultiline]}
              multiline
            />

            <Text style={styles.fieldLabel}>{t('home.hashtagsLabel')}</Text>
            <TextInput
              value={seoHashtags}
              onChangeText={setSeoHashtags}
              placeholder={t('home.hashtagsPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>{t('home.keywordsLabel')}</Text>
            <TextInput
              value={seoKeywords}
              onChangeText={setSeoKeywords}
              placeholder={t('home.keywordsPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
            />

            {/* a képaránya CSAK a videónak van (a kép szabad W×H-t kap, a hangnak semmi) */}
            {kind === 'video' ? (
              <>
                <Text style={styles.fieldLabel}>{t('home.aspectLabel')}</Text>
                <View style={styles.aspectRow}>
                  {aspectRatios.map((option) => (
                    <Chip
                      key={option.id}
                      label={t(option.label)}
                      active={aspect === option.id}
                      onPress={() => setAspect(option.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* 🖼️ KÉP-projekt: dokumentum-típus + szabad vászon W×H + háttér (kép-editor) */}
            {kind === 'image' ? (
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
                      active={clampDim(imgW) === p.w && clampDim(imgH) === p.h}
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
                      onChangeText={(v) => setImgW(v.replace(/[^0-9]/g, ''))}
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
                      onChangeText={(v) => setImgH(v.replace(/[^0-9]/g, ''))}
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
                  value={bg === 'transparent' ? '' : bg}
                  onChangeText={setBg}
                  placeholder={t('home.bgHexPlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}

            {/* 🎚️ HANG-projekt: master-cél (az alap hangosság/plafon preset) */}
            {kind === 'audio' ? (
              <>
                <Text style={styles.fieldLabel}>{t('home.audioMasterLabel')}</Text>
                <Text style={styles.seoHint}>{t('home.audioMasterHint')}</Text>
                <View style={styles.aspectRow}>
                  {AUDIO_TARGETS.map((tg) => (
                    <Chip
                      key={tg}
                      label={t(`studio.master.target.${tg}`)}
                      active={audioTarget === tg}
                      onPress={() => setAudioTarget(tg)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* 🗂️ FORRÁS-MAPPA — minden fajtánál: a támogatott fájlok importja már itt */}
            <Text style={styles.fieldLabel}>{t('home.sourceLabel')}</Text>
            <Text style={styles.seoHint}>{t('home.sourceHint')}</Text>
            <View style={styles.aspectRow}>
              {supportedSourceKinds(kind).map((sk) => (
                <Pressable key={sk} style={styles.sourceBtn} onPress={() => addSource(sk)}>
                  <Ionicons name="add" size={14} color={palette.accent} />
                  <Text style={styles.sourceBtnText}>{t(`studio.kind.${sk}`)}</Text>
                </Pressable>
              ))}
            </View>
            {sources.length > 0 ? (
              <View style={styles.sourceList}>
                {sources.map((a) => (
                  <View key={a.id} style={styles.sourceItem}>
                    <Ionicons
                      name={a.kind === 'video' ? 'videocam' : a.kind === 'audio' ? 'musical-notes' : 'image'}
                      size={14}
                      color={palette.textDim}
                    />
                    <Text style={styles.sourceItemName} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Pressable
                      onPress={() => removeSource(a.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.delete')}
                    >
                      <Ionicons name="close" size={16} color={palette.textDim} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          <PrimaryButton
            icon="checkmark"
            label={t('common.create')}
            disabled={!seoReady}
            onPress={onCreate}
          />
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: palette.border,
    padding: 20,
    paddingBottom: 34,
    gap: 14,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 2,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '800',
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  modalScrollContent: {
    gap: 8,
    paddingBottom: 4,
  },
  fieldLabel: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  seoHint: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 15,
    marginTop: -4,
  },
  aspectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bgRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  dimField: {
    flex: 1,
    gap: 4,
  },
  dimLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
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
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.border,
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: palette.accent,
  },
  swatchTransparent: {
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.surfaceHigh,
  },
  sourceBtnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  sourceList: { gap: 6, marginTop: 2 },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sourceItemName: { flex: 1, color: palette.text, fontSize: 13 },
  kindRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kindTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    backgroundColor: palette.surfaceHigh,
  },
  kindTileActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  kindTileLabel: {
    color: palette.textDim,
    fontSize: 13,
    fontWeight: '800',
  },
  kindTileLabelActive: {
    color: palette.text,
  },
  kindTileDesc: {
    color: palette.textDim,
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  cancelText: {
    color: palette.textDim,
    fontSize: 13,
  },
});
