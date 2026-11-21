import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from '@/components/studio/createProject/createProjectStyles';
import {
  AudioOptionsSection,
  DesignTemplateSection,
  Model3dFormatSection,
  VideoAspectSection,
} from '@/components/studio/createProject/KindOptionsSections';
import { ImageOptionsSection } from '@/components/studio/createProject/ImageOptionsSection';
import { KindPicker } from '@/components/studio/createProject/KindPicker';
import { SeoFields } from '@/components/studio/createProject/SeoFields';
import { SourceFolderSection } from '@/components/studio/createProject/SourceFolderSection';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { CreateFieldId } from '@/lib/createProjectForm';
import { supportedSourceKinds, type SourceKind } from '@/lib/projectSource';
import type { Layout } from '@/hooks/useLayout';
import type { AspectRatio, Asset, AudioMasterTarget, ProjectKind } from '@/types/project';
import type { MeshFormat } from '@/types/model3d';
import type { AudioTemplate } from '@/lib/audioTemplates';

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
  audioTemplate: AudioTemplate;
  setAudioTemplate: (tpl: AudioTemplate) => void;
  /** 🎨 S8: a Design-projekt induló sablonja */
  designTemplate: string;
  setDesignTemplate: (key: string) => void;
  // 3D
  model3dFormat: MeshFormat;
  setModel3dFormat: (f: MeshFormat) => void;
  // forrás-mappa
  sources: Asset[];
  addSource: (sk: SourceKind) => void;
  removeSource: (id: string) => void;
  // gomb-állapot + akciók
  seoReady: boolean;
  /** a hiányzó kötelező mezők (sorrendben) — a gomb alatt kiírjuk, koppintásra az elsőre ugrunk */
  missingFields: CreateFieldId[];
  onCreate: () => void;
  onCancel: () => void;
}) {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne (a ref-es mezők a SeoFields-be kerültek),
  // de a memoizálás bekapcsolása viselkedés-változás → külön döntés
  // (tools/reactCompiler.test.js KNOWN_BAILS). Addig szándékosan kimarad.
  'use no memo';
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
    audioTemplate,
    setAudioTemplate,
    designTemplate,
    setDesignTemplate,
    model3dFormat,
    setModel3dFormat,
    sources,
    addSource,
    removeSource,
    seoReady,
    missingFields,
    onCreate,
    onCancel,
  } = props;
  const insets = useSafeAreaInsets();
  // a mezők refjei — a „Hiányzik: …" sorra koppintva az ELSŐ hiányzóra ugrunk (T1/11)
  const fieldRefs = {
    name: useRef<TextInput>(null),
    description: useRef<TextInput>(null),
    hashtags: useRef<TextInput>(null),
    keywords: useRef<TextInput>(null),
  };
  const fieldLabel: Record<CreateFieldId, string> = {
    name: t('home.titleLabel'),
    description: t('home.descriptionLabel'),
    hashtags: t('home.hashtagsLabel'),
    keywords: t('home.keywordsLabel'),
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        // a kártya sosem csúszhat az állapotsor / Dynamic Island alá (billentyűzetnél sem, T1/9)
        style={[styles.modalBackdrop, { paddingTop: insets.top + 8 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalGrabber} />
          <Text style={styles.modalTitle}>{t('home.newProject')}</Text>
          <ScrollView
            // a görgethető rész ZSUGORODIK, ha kevés a hely (billentyűzet) — a fejléc és a gombok maradnak
            style={{ maxHeight: Math.round(L.height * 0.5), flexShrink: 1 }}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <KindPicker kind={kind} setKind={setKind} />

            <SeoFields
              kind={kind}
              fieldRefs={fieldRefs}
              name={name}
              setName={setName}
              seoDescription={seoDescription}
              setSeoDescription={setSeoDescription}
              seoHashtags={seoHashtags}
              setSeoHashtags={setSeoHashtags}
              seoKeywords={seoKeywords}
              setSeoKeywords={setSeoKeywords}
            />

            {/* a képaránya CSAK a videónak van (a kép szabad W×H-t kap, a hangnak semmi) */}
            {kind === 'video' ? <VideoAspectSection aspect={aspect} setAspect={setAspect} /> : null}

            {/* 🎨 DESIGN-projekt (S8): a sablon adja a vásznat és a rétegeket — a Kép Stúdió Design munkaterületén nyílik */}
            {kind === 'design' ? (
              <DesignTemplateSection designTemplate={designTemplate} setDesignTemplate={setDesignTemplate} />
            ) : null}

            {/* 🖼️ KÉP-projekt: dokumentum-típus + szabad vászon W×H + háttér (kép-editor) */}
            {kind === 'image' ? (
              <ImageOptionsSection
                imgW={imgW}
                setImgW={setImgW}
                imgH={imgH}
                setImgH={setImgH}
                imgFormat={imgFormat}
                setImgFormat={setImgFormat}
                bg={bg}
                setBg={setBg}
              />
            ) : null}

            {/* 🎚️ HANG-projekt: master-cél (az alap hangosság/plafon preset) */}
            {kind === 'audio' || kind === 'music' ? (
              <AudioOptionsSection
                audioTarget={audioTarget}
                setAudioTarget={setAudioTarget}
                audioTemplate={audioTemplate}
                setAudioTemplate={setAudioTemplate}
              />
            ) : null}

            {/* 🧊 3D-projekt: a modell tárolási formátuma (a projekt mappájában ebben él) */}
            {kind === 'model3d' ? (
              <Model3dFormatSection model3dFormat={model3dFormat} setModel3dFormat={setModel3dFormat} />
            ) : null}

            {/* 🗂️ FORRÁS-MAPPA — a támogatott fájlok importja már itt (a 3D-nél nincs: csak LiDAR-szken) */}
            {supportedSourceKinds(kind).length > 0 ? (
              <SourceFolderSection kind={kind} sources={sources} addSource={addSource} removeSource={removeSource} />
            ) : null}
          </ScrollView>
          <PrimaryButton
            icon="checkmark"
            label={t('common.create')}
            disabled={!seoReady}
            onPress={onCreate}
          />
          {missingFields.length > 0 ? (
            <Pressable
              onPress={() => fieldRefs[missingFields[0]].current?.focus()}
              hitSlop={8}
              style={styles.missingRow}
              accessibilityRole="button"
              accessibilityHint={t('home.missingFieldsHint')}
            >
              <Ionicons name="alert-circle-outline" size={14} color={palette.warning} />
              <Text style={styles.missingText} numberOfLines={2}>
                {t('home.missingFields', { fields: missingFields.map((f) => fieldLabel[f]).join(' · ') })}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
