import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { type CacheReport, formatBytes } from '@/lib/cacheManager';
import type { ProxyQuality } from '@/store/editorStore';
import { profileStyles as styles } from './styles';

/**
 * 🎯 Teljesítmény / gyorsítótár: proxy be/ki + minőség, gyorsítótár-méret + ürítés.
 * Prezentációs — az editor-store setterek + a cache-handler propból jönnek.
 */
export function PerformanceCard({
  proxyEnabled,
  proxyQuality,
  setProxyEnabled,
  setProxyQuality,
  cacheInfo,
  onClearCache,
}: {
  proxyEnabled: boolean;
  proxyQuality: ProxyQuality;
  setProxyEnabled: (on: boolean) => void;
  setProxyQuality: (q: ProxyQuality) => void;
  cacheInfo: CacheReport;
  onClearCache: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.perfSection')}</Text>
      <Text style={styles.sectionHint}>{t('profile.perfHint')}</Text>
      <View style={styles.card}>
        <View style={styles.perfRow}>
          <Text style={styles.perfLabel}>{t('profile.proxyLabel')}</Text>
          <Chip
            label={proxyEnabled ? t('common.on') : t('common.off')}
            active={proxyEnabled}
            onPress={() => setProxyEnabled(!proxyEnabled)}
          />
        </View>
        {proxyEnabled ? (
          <View style={styles.perfRow}>
            <Text style={styles.perfLabel}>{t('profile.proxyQuality')}</Text>
            <View style={styles.perfChips}>
              {(['low', 'medium', 'high'] as ProxyQuality[]).map((q) => (
                <Chip
                  key={q}
                  label={t('profile.proxyQuality_' + q)}
                  active={proxyQuality === q}
                  onPress={() => setProxyQuality(q)}
                />
              ))}
            </View>
          </View>
        ) : null}
        <View style={styles.perfRow}>
          <Text style={styles.perfLabel}>{t('profile.cacheSize')}</Text>
          <Text style={styles.perfValue}>{formatBytes(cacheInfo.total)}</Text>
        </View>
        <Pressable onPress={onClearCache} style={styles.signOutBtn}>
          <Ionicons name="trash-outline" size={18} color={palette.danger} />
          <Text style={styles.signOutText}>{t('profile.clearCache')}</Text>
        </Pressable>
      </View>
    </>
  );
}
