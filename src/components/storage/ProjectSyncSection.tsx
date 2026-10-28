import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { loadSyncPrefs, saveSyncPrefs } from '@/lib/networkPolicy';
import { projectFolderPath } from '@/lib/projectFolder';
import { projectFolderBytes } from '@/lib/projectFolderClient';
import {
  checkSyncCapacity,
  requestProjectSync,
  setProjectSyncEnabled,
  useProjectSyncState,
} from '@/lib/projectSyncClient';
import { loadProject } from '@/lib/storage';
import { formatBytes } from '@/lib/storageQuota';
import type { Project } from '@/types/project';

/**
 * ⚙️ Projekt-beállítás: „Tárhely és szinkron". Megmutatja a projekt telefonos
 * mappáját (csak a projekt törlésével törölhető), és itt kapcsolható be az
 * egyirányú szinkron a ReMix Storage-ba — csak ha a mappa belefér a kvótába.
 */
export function ProjectSyncSection({ projectId, onChanged }: { projectId: string; onChanged?: (p: Project) => void }) {
  const { t } = useTranslation();
  const [project, setProject] = useState<Project | null>(null);
  const [bytes, setBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const sync = useProjectSyncState(projectId);
  const [wifiOnly, setWifiOnly] = useState(true);

  useEffect(() => {
    void loadSyncPrefs().then((p) => setWifiOnly(p.wifiOnly));
  }, []);

  const reload = useCallback(() => {
    void loadProject(projectId).then((p) => {
      setProject(p);
      setBytes(p?.folder ? projectFolderBytes(p.folder) : 0);
    });
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!project) {
    return <ActivityIndicator color={palette.accent} style={styles.loading} />;
  }

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      if (enabled) {
        const cap = await checkSyncCapacity(project);
        if (!cap.signedIn) {
          Alert.alert(t('storage.sync.title'), t('storage.errors.unauthorized'));
          return;
        }
        if (!cap.ok) {
          Alert.alert(
            t('storage.sync.noSpaceTitle'),
            t('storage.sync.noSpaceBody', {
              need: formatBytes(cap.uploadBytes),
              free: formatBytes(Math.max(0, cap.quotaBytes - cap.usedBytes)),
              missing: formatBytes(cap.missingBytes),
            }),
            [
              { text: t('common.close'), style: 'cancel' },
              { text: t('storage.openProfile'), onPress: () => router.push('/profile') },
            ]
          );
          return;
        }
      }
      const next = await setProjectSyncEnabled(project.id, enabled);
      if (next) {
        setProject(next);
        onChanged?.(next);
      }
    } catch (err) {
      Alert.alert(t('storage.sync.title'), err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const enabled = Boolean(project.syncToRemix);
  const phase = enabled ? (sync.phase === 'off' ? 'pending' : sync.phase) : 'off';
  const statusColor =
    phase === 'synced' ? palette.ok : phase === 'failed' || phase === 'quota' ? palette.danger : palette.textDim;

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Ionicons name="phone-portrait-outline" size={18} color={palette.accent} />
        <View style={styles.body}>
          <Text style={styles.title}>{t('storage.sync.folderTitle')}</Text>
          <Text style={styles.meta} numberOfLines={2}>
            {t('storage.locations.device')} › {project.folder ? projectFolderPath(project.folder) : '—'} · {formatBytes(bytes)}
          </Text>
          <Text style={styles.hint}>{t('storage.sync.folderLocked')}</Text>
        </View>
      </View>

      <View style={styles.row}>
        <Ionicons name="cloud-upload-outline" size={18} color={palette.accent} />
        <View style={styles.body}>
          <Text style={styles.title}>{t('storage.sync.title')}</Text>
          <Text style={styles.hint}>{t('storage.sync.explain')}</Text>
        </View>
        {busy ? (
          <ActivityIndicator color={palette.accent} />
        ) : (
          <Switch
            value={enabled}
            onValueChange={(v) => void toggle(v)}
            disabled={!project.folder}
            trackColor={{ true: palette.accent, false: palette.border }}
          />
        )}
      </View>

      {enabled ? (
        <View style={styles.row}>
          <Ionicons name="wifi-outline" size={18} color={palette.textDim} />
          <View style={styles.body}>
            <Text style={styles.meta}>{t('storage.sync.wifiOnly')}</Text>
            <Text style={styles.hint}>{t('storage.sync.wifiOnlyHint')}</Text>
          </View>
          <Switch
            value={wifiOnly}
            onValueChange={(v) => {
              setWifiOnly(v);
              void saveSyncPrefs({ wifiOnly: v });
            }}
            trackColor={{ true: palette.accent, false: palette.border }}
          />
        </View>
      ) : null}

      {enabled ? (
        <View style={styles.statusRow}>
          <Text style={[styles.status, { color: statusColor }]}>
            {t(`storage.sync.phase.${phase}`, {
              done: sync.done,
              total: sync.total,
              pct: Math.round(sync.progress * 100),
              missing: formatBytes(sync.missingBytes ?? 0),
            })}
            {phase === 'synced' && sync.lastSyncedAt ? ` · ${new Date(sync.lastSyncedAt).toLocaleString()}` : ''}
          </Text>
          {phase !== 'syncing' ? (
            <Pressable onPress={() => void requestProjectSync(project, { manual: true })} hitSlop={8}>
              <Text style={styles.link}>{t('storage.sync.now')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {enabled && sync.error && (phase === 'failed' || phase === 'offline') ? (
        <Text style={styles.error} numberOfLines={3}>
          {sync.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 12 },
  box: {
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  body: { flex: 1, gap: 2 },
  title: { color: palette.text, fontSize: 14, fontWeight: '700' },
  meta: { color: palette.text, fontSize: 12 },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  status: { fontSize: 12, fontWeight: '600', flex: 1 },
  link: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 12 },
});
