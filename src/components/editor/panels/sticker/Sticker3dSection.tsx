import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/sticker/stickerStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import { renderServerUrl } from '@/lib/render';
import { sticker3dPreviewUrl } from '@/lib/stickerPanelOps';
import { STICKER_ENVIRONMENTS, STICKER_MATERIALS } from '@/lib/stickers3d';
import type { Sticker3DEntry } from '@/lib/stickers3d';

export interface Sticker3dSectionProps {
  stickers3d: Sticker3DEntry[];
  busy3d: string | null;
  material: string;
  setMaterial: (id: string) => void;
  environment: string;
  setEnvironment: (id: string) => void;
  addSticker3d: (entry: Sticker3DEntry) => Promise<void>;
}

/** 🧊 3D objektumok a workerről (CC0 glTF-csomag): előnézet, anyag, környezet */
export function Sticker3dSection({
  stickers3d,
  busy3d,
  material,
  setMaterial,
  environment,
  setEnvironment,
  addSticker3d,
}: Sticker3dSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.sticker.objects3dTitle')}>
      <View style={styles.shapeRow3d}>
        {stickers3d.map((entry) => (
          <Pressable
            key={entry.id}
            style={styles.shapeCell}
            onPress={() => {
              void addSticker3d(entry);
            }}
          >
            <Image
              source={{
                uri: sticker3dPreviewUrl(renderServerUrl(), entry.url, material, environment),
              }}
              style={styles.preview3d}
              contentFit="contain"
            />
            <Text style={styles.shapeLabel}>
              {busy3d === entry.id ? '⏳…' : entry.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.subLabel}>{t('panels.sticker.material')}</Text>
      <View style={styles.chipRow}>
        {STICKER_MATERIALS.map((m) => (
          <Chip
            key={m.id}
            label={m.label}
            active={material === m.id}
            onPress={() => setMaterial(m.id)}
          />
        ))}
      </View>
      <Text style={styles.subLabel}>{t('panels.sticker.environment')}</Text>
      <View style={styles.chipRow}>
        {STICKER_ENVIRONMENTS.map((e) => (
          <Chip
            key={e.id}
            label={e.label}
            active={environment === e.id}
            onPress={() => setEnvironment(e.id)}
          />
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.sticker.objects3dNote')}
      </Text>
    </PanelSection>
  );
}
