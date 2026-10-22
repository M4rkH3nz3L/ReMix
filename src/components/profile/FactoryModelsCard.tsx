import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import {
  catalogAvailability,
  MODEL_CATALOG,
  type CatalogAvailability,
  type CatalogEntry,
  type CatalogRuntime,
} from '@/lib/modelCatalog';
import {
  cachedModelsTotalBytes,
  catalogRuntime,
  downloadModel,
  MODEL_CACHE_MAX_BYTES,
  removeModel,
} from '@/lib/modelRegistryClient';
import { profileStyles as styles } from './styles';

/**
 * 🏭 Gyári AI-modellek (local-ai 5.1/5.4): a katalógus user-setup nélkül látszik —
 * cél-címkével („csak erre való"), letöltés/törlés akcióval és őszinte státusszal
 * (a device-motorok natív bekötéséig: „új dev-build kell"). A letöltés checksum-
 * ellenőrzött (`modelRegistryClient`), a használat a smoke-test PASS-hoz kötött.
 */

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** mely státuszokhoz jár törlés-gomb (van lemezen fájl) */
const DELETABLE: ReadonlySet<CatalogAvailability> = new Set(['downloaded', 'validated', 'failed']);

export function FactoryModelsCard() {
  const { t } = useTranslation();
  const [runtime, setRuntime] = useState<CatalogRuntime>({});
  const [usedBytes, setUsedBytes] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRuntime(catalogRuntime());
    setUsedBytes(cachedModelsTotalBytes());
  }, []);

  useEffect(() => {
    // a setState mikrotaszkban fut, nem az effekt szinkron testében
    // (react-hooks/set-state-in-effect — a useProfile ugyanígy csinálja)
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const onDownload = (entry: CatalogEntry) => {
    if (!entry.manifest || busyId) {
      return;
    }
    setBusyId(entry.id);
    downloadModel(entry.manifest)
      .then((res) => {
        if (!res.ok) {
          Alert.alert(t('common.error'), t('profile.modelDownloadFailed', { reason: res.reason }));
        }
      })
      .finally(() => {
        setBusyId(null);
        refresh();
      });
  };

  const onRemove = (entry: CatalogEntry) => {
    removeModel(entry.id);
    refresh();
  };

  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.factoryModels')}</Text>
      <Text style={styles.sectionHint}>{t('profile.factoryModelsHint')}</Text>
      <View style={styles.card}>
        {MODEL_CATALOG.map((entry) => {
          const availability = catalogAvailability(entry, runtime);
          const usable = availability === 'active' || availability === 'validated';
          return (
            <View key={entry.id} style={styles.providerRow}>
              <View style={styles.providerMain}>
                <Text style={{ fontSize: 22 }}>{entry.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.providerTitleRow}>
                    <Text style={styles.providerLabel} numberOfLines={1}>
                      {entry.label}
                    </Text>
                    <View style={styles.defaultBadge}>
                      <Text
                        style={[
                          styles.defaultBadgeText,
                          { color: usable ? palette.accent : palette.textDim },
                        ]}
                      >
                        {t('profile.modelStatus_' + availability)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.providerMeta} numberOfLines={2}>
                    {t('profile.catalog_' + entry.id)}
                    {entry.manifest ? ` · ${mb(entry.manifest.sizeBytes)}` : ''}
                  </Text>
                </View>
              </View>
              {busyId === entry.id ? (
                <ActivityIndicator size="small" color={palette.accent} />
              ) : availability === 'downloadable' ? (
                <Pressable onPress={() => onDownload(entry)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="download-outline" size={20} color={palette.accent} />
                </Pressable>
              ) : DELETABLE.has(availability) ? (
                <Pressable onPress={() => onRemove(entry)} hitSlop={8} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={20} color={palette.danger} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.sectionHint}>
          {t('profile.factoryStorage', {
            used: mb(usedBytes),
            max: mb(MODEL_CACHE_MAX_BYTES),
          })}
        </Text>
      </View>
    </>
  );
}
