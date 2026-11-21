import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { styles } from '@/components/profile/storage/storageStyles';
import { palette } from '@/constants/editor';
import { type ConnectedProvider, type ExternalProviderType, EXTERNAL_PROVIDERS } from '@/lib/externalStorage';
import { fileKindEmoji } from '@/lib/storageCardOps';
import type { StorageEntry } from '@/lib/storageProviders';
import { formatBytes } from '@/lib/storageQuota';

/** ☁️ külső tárhelyek: aktív cél, bekötött források (fájl-lista, leválasztás), új forrás (a StorageCard.tsx-ből kiemelve) */
export function ExternalStorageSection({
  providers,
  defaultId,
  busy,
  expanded,
  files,
  onSelectTarget,
  onToggleFiles,
  onDisconnect,
  startConnect,
}: {
  providers: ConnectedProvider[];
  defaultId: string | null;
  busy: boolean;
  expanded: string | null;
  files: StorageEntry[] | null;
  onSelectTarget: (sourceId: string | null) => void;
  onToggleFiles: (id: string) => void;
  onDisconnect: (p: ConnectedProvider) => void;
  startConnect: (type: ExternalProviderType, oauth: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.storage.externalSection')}</Text>
      <Text style={styles.sectionHint}>{t('profile.storage.externalHint')}</Text>
      <View style={styles.card}>
        {/* aktív tárhely-cél: ide ment minden studio, és innen olvas vissza */}
        <Text style={styles.addTitle}>{t('profile.storage.activeTarget')}</Text>
        <Text style={[styles.dim, { marginBottom: 8 }]}>{t('profile.storage.activeTargetHint')}</Text>
        <Pressable onPress={() => onSelectTarget(null)} disabled={busy} style={styles.providerRow}>
          <Ionicons
            name={!defaultId ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={!defaultId ? palette.accent : palette.textDim}
          />
          <Ionicons name="cloud-done-outline" size={18} color={palette.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.providerLabel}>ReMix</Text>
            <Text style={styles.dim}>{t('profile.storage.remixTarget')}</Text>
          </View>
        </Pressable>

        {providers.length === 0 ? null : (
          providers.map((p) => {
            const meta = EXTERNAL_PROVIDERS.find((m) => m.type === p.type);
            return (
              <View key={p.id} style={styles.providerBlock}>
                <View style={styles.providerRow}>
                  <Pressable onPress={() => onSelectTarget(p.id)} disabled={busy} hitSlop={8}>
                    <Ionicons
                      name={p.isDefault ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={p.isDefault ? palette.accent : palette.textDim}
                    />
                  </Pressable>
                  <Ionicons name={(meta?.icon ?? 'cloud-outline') as never} size={18} color={palette.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.providerLabel} numberOfLines={1}>
                      {p.label}
                    </Text>
                    <Text style={styles.dim}>{meta?.label ?? p.type}</Text>
                  </View>
                  <Pressable onPress={() => onToggleFiles(p.id)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name={expanded === p.id ? 'chevron-up' : 'folder-open-outline'} size={19} color={palette.textDim} />
                  </Pressable>
                  <Pressable onPress={() => onDisconnect(p)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="unlink-outline" size={19} color={palette.danger} />
                  </Pressable>
                </View>
                {expanded === p.id ? (
                  files === null ? (
                    <ActivityIndicator color={palette.accent} style={{ marginVertical: 8 }} />
                  ) : files.length === 0 ? (
                    <Text style={[styles.dim, { marginTop: 6 }]}>{t('profile.storage.emptyFolder')}</Text>
                  ) : (
                    <View style={styles.fileList}>
                      {files.slice(0, 20).map((f) => (
                        <Text key={f.id} style={styles.fileRow} numberOfLines={1}>
                          {fileKindEmoji(f.kind)} {f.name}
                          {f.size ? ` · ${formatBytes(f.size)}` : ''}
                        </Text>
                      ))}
                      {files.length > 20 ? (
                        <Text style={styles.dim}>{t('profile.storage.andMore', { n: files.length - 20 })}</Text>
                      ) : null}
                    </View>
                  )
                ) : null}
              </View>
            );
          })
        )}

        <Text style={[styles.addTitle, { marginTop: providers.length ? 14 : 0 }]}>
          {t('profile.storage.addProvider')}
        </Text>
        <View style={styles.addRow}>
          {EXTERNAL_PROVIDERS.map((m) => (
            <Pressable
              key={m.type}
              onPress={() => startConnect(m.type, m.oauth)}
              disabled={busy}
              style={styles.addChip}
            >
              <Ionicons name={m.icon as never} size={16} color={palette.text} />
              <Text style={styles.addChipText}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );
}
