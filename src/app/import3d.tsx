import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { nameFromFile } from '@/lib/model3dImport';
import { isKindAvailable } from '@/lib/projectKinds';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';

/**
 * 📲 Bejövő 3D-fájl („Megnyitás a ReMix-szel"): új 3D-projekt a fájl nevével, majd a 3D
 * Stúdió azonnal importálja (`importUri`). LiDAR nélküli eszközön a 3D Stúdió nem létezik
 * (3D-Studio.md §1.1) → érthető üzenet és vissza a Stúdióba.
 */
export default function Import3DRoute() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const { t } = useTranslation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const run = async () => {
      if (!uri) {
        router.replace('/studio');
        return;
      }
      if (!isKindAvailable('model3d')) {
        Alert.alert(t('model3d.import.title'), t('model3d.import.noLidar'));
        router.replace('/studio');
        return;
      }
      const project = createEmptyProject(nameFromFile(uri), '9:16', undefined, 'model3d');
      await saveProject(project);
      router.replace(`/studio/model3d/${project.id}?importUri=${encodeURIComponent(uri)}`);
    };
    run().catch(() => router.replace('/studio'));
  }, [uri, t]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={palette.accent} />
      <Text style={styles.text}>{t('model3d.import.opening')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: palette.bg },
  text: { color: palette.textDim, fontSize: 14 },
});
