import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/studio/createProject/createProjectStyles';
import { palette } from '@/constants/editor';
import { sourceAssetIcon } from '@/lib/createProjectModalOps';
import { supportedSourceKinds, type SourceKind } from '@/lib/projectSource';
import type { Asset, ProjectKind } from '@/types/project';

/** 🗂️ FORRÁS-MAPPA — a támogatott fájlok importja már itt (a CreateProjectModal.tsx-ből kiemelve) */
export function SourceFolderSection({
  kind,
  sources,
  addSource,
  removeSource,
}: {
  kind: ProjectKind;
  sources: Asset[];
  addSource: (sk: SourceKind) => void;
  removeSource: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
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
                name={sourceAssetIcon(a.kind)}
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
    </>
  );
}
