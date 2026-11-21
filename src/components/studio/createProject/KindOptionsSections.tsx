import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/studio/createProject/createProjectStyles';
import { Chip } from '@/components/ui/controls';
import { aspectRatios } from '@/constants/editor';
import { AUDIO_TEMPLATES, type AudioTemplate } from '@/lib/audioTemplates';
import { AUDIO_TARGETS } from '@/lib/createProjectModalOps';
import { IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { STORAGE_FORMATS } from '@/lib/model3dExport';
import type { MeshFormat } from '@/types/model3d';
import type { AspectRatio, AudioMasterTarget } from '@/types/project';

/**
 * 🎛️ A fajta-specifikus kis beállítás-szekciók (a CreateProjectModal.tsx-ből kiemelve):
 * videó képarány, Design-sablon, hang sablon + master-cél, 3D tárolási formátum.
 * A kép-projekté a saját fájljában él (ImageOptionsSection).
 */

/** a képaránya CSAK a videónak van (a kép szabad W×H-t kap, a hangnak semmi) */
export function VideoAspectSection({ aspect, setAspect }: { aspect: AspectRatio; setAspect: (a: AspectRatio) => void }) {
  const { t } = useTranslation();
  return (
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
  );
}

/** 🎨 DESIGN-projekt (S8): a sablon adja a vásznat és a rétegeket — a Kép Stúdió Design munkaterületén nyílik */
export function DesignTemplateSection({
  designTemplate,
  setDesignTemplate,
}: {
  designTemplate: string;
  setDesignTemplate: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.fieldLabel}>{t('studio.image.templates.title')}</Text>
      <View style={styles.aspectRow}>
        {IMAGE_TEMPLATES.map((tpl) => (
          <Chip
            key={tpl.key}
            label={`${t(`studio.image.templates.${tpl.key}`)} · ${tpl.width}×${tpl.height}`}
            active={designTemplate === tpl.key}
            onPress={() => setDesignTemplate(tpl.key)}
          />
        ))}
      </View>
    </>
  );
}

/** 🎚️ HANG-projekt: master-cél (az alap hangosság/plafon preset) */
export function AudioOptionsSection({
  audioTarget,
  setAudioTarget,
  audioTemplate,
  setAudioTemplate,
}: {
  audioTarget: AudioMasterTarget;
  setAudioTarget: (tg: AudioMasterTarget) => void;
  audioTemplate: AudioTemplate;
  setAudioTemplate: (tpl: AudioTemplate) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🧩 indító-sablon: sávok, tempó, jelölők, hangosság */}
      <Text style={styles.fieldLabel}>{t('studio.audio.template.label')}</Text>
      <View style={styles.aspectRow}>
        {AUDIO_TEMPLATES.map((tpl) => (
          <Chip key={tpl} label={t(`studio.audio.template.${tpl}`)} active={audioTemplate === tpl} onPress={() => setAudioTemplate(tpl)} />
        ))}
      </View>
      <Text style={styles.seoHint}>{t(`studio.audio.template.${audioTemplate}Hint`)}</Text>
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
  );
}

/** 🧊 3D-projekt: a modell tárolási formátuma (a projekt mappájában ebben él) */
export function Model3dFormatSection({
  model3dFormat,
  setModel3dFormat,
}: {
  model3dFormat: MeshFormat;
  setModel3dFormat: (f: MeshFormat) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.fieldLabel}>{t('home.model3dFormatLabel')}</Text>
      <Text style={styles.seoHint}>{t(`home.model3dFormatHint_${model3dFormat}`)}</Text>
      <View style={styles.aspectRow}>
        {STORAGE_FORMATS.map((f) => (
          <Chip key={f} label={f.toUpperCase()} active={model3dFormat === f} onPress={() => setModel3dFormat(f)} />
        ))}
      </View>
    </>
  );
}
