import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/studio/createProject/createProjectStyles';
import { palette } from '@/constants/editor';
import { creatableKinds } from '@/lib/projectKinds';
import type { ProjectKind } from '@/types/project';

/** 🎛️ Az „Új projekt" választója = a LÉTREHOZHATÓ (kész stúdiójú) ÉS ezen az eszközön
 *  elérhető fajták — a katalógusból (`@/lib/projectKinds`), hogy sose kínáljon félkész
 *  stúdiót, és LiDAR nélkül a 3D-t se (3D-Studio.md §1.1). Renderkor számolva, mert a
 *  képesség-lekérdezés az indításkor aszinkron fut le. */
function studioKinds(): { id: ProjectKind; icon: keyof typeof Ionicons.glyphMap }[] {
  return creatableKinds().map((m) => ({
    id: m.id,
    icon: `${m.icon}-outline` as keyof typeof Ionicons.glyphMap,
  }));
}

/** 🎛️ a stúdió-fajta választó (a CreateProjectModal.tsx-ből kiemelve) */
export function KindPicker({ kind, setKind }: { kind: ProjectKind; setKind: (k: ProjectKind) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎛️ a három stúdió: videó / kép / hang — ez határozza meg, melyik
          szerkesztő nyílik meg (ez a 3 együtt maga a Studio) */}
      <Text style={styles.fieldLabel}>{t('studio.chooseKind')}</Text>
      <View style={styles.kindRow}>
        {studioKinds().map((k) => {
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
    </>
  );
}
