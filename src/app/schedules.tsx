import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { formatEta } from '@/lib/progress';
import {
  fetchRenderQueue,
  type RenderJob,
  type RenderPhase,
  type RenderQueue,
  type RenderWorker,
} from '@/lib/schedules';

const POLL_MS = 4000;
const DONE_GREEN = '#3ddc84';

type IconName = keyof typeof Ionicons.glyphMap;

// fázis → ikon + szín (a chiphez és a worker-feladatokhoz)
const PHASE_META: Record<RenderPhase, { icon: IconName; color: string }> = {
  download: { icon: 'cloud-download-outline', color: '#5ac8fa' },
  render: { icon: 'film-outline', color: palette.accent },
  upload: { icon: 'cloud-upload-outline', color: '#ffb454' },
};

const STATE_META: Record<RenderJob['state'], { icon: IconName; color: string }> = {
  active: { icon: 'sync', color: palette.accent },
  waiting: { icon: 'time-outline', color: palette.textDim },
  completed: { icon: 'checkmark-circle', color: DONE_GREEN },
  failed: { icon: 'alert-circle', color: palette.danger },
};

/** Egy job beszédes, lefordított egymondatos leírása. */
function useJobDescription() {
  const { t } = useTranslation();
  return (job: RenderJob) => {
    const name = job.projectName || t('schedules.untitled');
    if (job.state === 'waiting') {
      return t('schedules.desc.waiting', { name });
    }
    if (job.state === 'completed') {
      return t('schedules.desc.completed', { name });
    }
    if (job.state === 'failed') {
      return t('schedules.desc.failed', { name });
    }
    return t(`schedules.desc.${job.phaseKey || 'render'}`, { name });
  };
}

export default function SchedulesScreen() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<RenderQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const q = await fetchRenderQueue(ctrl.signal);
      if (!ctrl.signal.aborted) {
        setQueue(q);
        setError(null);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError((e as Error).message || t('schedules.unreachable'));
      }
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
      }
    }
  }, [t]);

  // fókuszban tartva: azonnali betöltés + időzített frissítés; blur-nál leáll
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      void load();
      const id = setInterval(() => {
        if (alive) {
          void load();
        }
      }, POLL_MS);
      return () => {
        alive = false;
        clearInterval(id);
        abortRef.current?.abort();
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const jobs = queue?.jobs ?? [];
  const workers = queue?.workers ?? [];
  const activeCount = jobs.filter((j) => j.state === 'active').length;
  const waitingCount = jobs.filter((j) => j.state === 'waiting').length;

  const renderHeader = () => {
    if (!queue) {
      return null;
    }
    if (!queue.enabled) {
      return (
        <InfoCard
          icon="cloud-offline-outline"
          title={t('schedules.disabledTitle')}
          body={t('schedules.disabledBody')}
        />
      );
    }
    return (
      <View style={{ gap: 14 }}>
        <View style={styles.summaryRow}>
          <SummaryStat value={activeCount} label={t('schedules.stateActive')} color={palette.accent} />
          <SummaryStat value={waitingCount} label={t('schedules.stateWaiting')} color={palette.text} />
          <SummaryStat value={workers.length} label={t('schedules.workersLabel')} color={palette.textDim} />
        </View>

        {queue.mineAhead != null ? (
          <View style={styles.mineCard}>
            <View style={styles.mineHead}>
              <Ionicons name="hourglass-outline" size={18} color={palette.accent} />
              <Text style={styles.mineTitle}>{t('schedules.yourRender')}</Text>
            </View>
            <Text style={styles.mineAhead}>
              {queue.mineAhead === 0
                ? t('schedules.youAreNext')
                : t('schedules.ahead', { count: queue.mineAhead })}
            </Text>
            <Text style={styles.mineEta}>
              {queue.mineEtaSec != null && formatEta(queue.mineEtaSec)
                ? t('schedules.readyIn', { eta: formatEta(queue.mineEtaSec) })
                : t('schedules.almostReady')}
            </Text>
            <View style={styles.notifyRow}>
              <Ionicons name="notifications-outline" size={13} color={palette.textDim} />
              <Text style={styles.notifyHint}>{t('schedules.notifyHint')}</Text>
            </View>
          </View>
        ) : null}

        {/* 🖥️ Worker-flotta: mit csinál éppen minden gép */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('schedules.workersTitle')}</Text>
          {workers.length === 0 ? (
            <Text style={styles.sectionEmpty}>{t('schedules.noWorkers')}</Text>
          ) : (
            workers.map((w) => <WorkerCard key={w.id} worker={w} />)
          )}
        </View>

        {jobs.length > 0 ? <Text style={styles.sectionTitle}>{t('schedules.queueTitle')}</Text> : null}
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      );
    }
    if (error) {
      return (
        <InfoCard icon="warning-outline" title={t('schedules.unreachable')} body={error}>
          <Pressable style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>{t('schedules.retry')}</Text>
          </Pressable>
        </InfoCard>
      );
    }
    if (queue && !queue.enabled) {
      return null; // a disabled-kártya a headerben van
    }
    return (
      <InfoCard
        icon="checkmark-done-outline"
        title={t('schedules.emptyTitle')}
        body={t('schedules.emptyBody')}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('schedules.title')}
        </Text>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={renderHeader()}
        ListEmptyComponent={renderEmpty()}
        renderItem={({ item }) => <JobRow job={item} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent} />
        }
      />
    </SafeAreaView>
  );
}

function JobRow({ job }: { job: RenderJob }) {
  const { t } = useTranslation();
  const describe = useJobDescription();
  const state = STATE_META[job.state];
  const eta = job.etaSec != null ? formatEta(job.etaSec) : null;

  // chip: futónál a FÁZIS (Betöltés/Renderelés/Feltöltés), különben az állapot
  const chip =
    job.state === 'active'
      ? { ...PHASE_META[job.phaseKey || 'render'], label: t(`schedules.phase.${job.phaseKey || 'render'}`) }
      : { icon: state.icon, color: state.color, label: t(`schedules.state${cap(job.state)}`) };

  return (
    <View style={[styles.row, job.mine && styles.rowMine]}>
      <View style={[styles.posBadge, job.mine && styles.posBadgeMine]}>
        {job.position != null ? (
          <Text style={[styles.posText, job.mine && styles.posTextMine]}>{job.position}</Text>
        ) : (
          <Ionicons name={state.icon} size={16} color={state.color} />
        )}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowDesc, job.mine && { color: palette.text }]} numberOfLines={2}>
            {job.mine ? `${t('schedules.mineTag')} ` : ''}
            {describe(job)}
          </Text>
          <View style={styles.chip}>
            <Ionicons name={chip.icon} size={12} color={chip.color} />
            <Text style={[styles.chipText, { color: chip.color }]}>{chip.label}</Text>
          </View>
        </View>

        {job.state === 'active' ? (
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.max(3, Math.min(100, job.progress))}%`, backgroundColor: chip.color },
              ]}
            />
          </View>
        ) : null}

        <Text style={styles.rowMeta} numberOfLines={1}>
          {job.state === 'failed'
            ? job.failedReason || t('schedules.stateFailed')
            : job.state === 'completed'
              ? t('schedules.doneMeta')
              : eta
                ? job.state === 'active'
                  ? t('schedules.rowReadyIn', { eta })
                  : t('schedules.rowStartsIn', { eta })
                : t('schedules.almostReady')}
        </Text>
      </View>
    </View>
  );
}

function WorkerCard({ worker }: { worker: RenderWorker }) {
  const { t } = useTranslation();
  const role = t(`schedules.role.${worker.roleKey}`);
  const roleDesc = t(`schedules.roleDesc.${worker.roleKey}`);
  const busy = worker.activeJobs.length > 0;

  return (
    <View style={styles.workerCard}>
      <View style={[styles.workerIcon, busy && styles.workerIconBusy]}>
        <Ionicons
          name={(worker.icon as IconName) || 'hardware-chip-outline'}
          size={20}
          color={busy ? palette.accent : palette.textDim}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.rowTop}>
          <Text style={styles.workerName} numberOfLines={1}>
            {t('schedules.workerName', { role, id: worker.shortId || worker.id.slice(0, 6) })}
          </Text>
          <View style={styles.chip}>
            <View
              style={[styles.dot, { backgroundColor: busy ? palette.accent : DONE_GREEN }]}
            />
            <Text style={[styles.chipText, { color: busy ? palette.accent : DONE_GREEN }]}>
              {busy ? t('schedules.workerStatus.busy') : t('schedules.workerStatus.idle')}
            </Text>
          </View>
        </View>
        <Text style={styles.workerRole} numberOfLines={2}>
          {roleDesc}
        </Text>
        <Text style={styles.workerCap}>
          {t('schedules.workerCapacity', { count: worker.concurrency })}
        </Text>

        {busy ? (
          <View style={styles.workerJobs}>
            {worker.activeJobs.map((aj) => (
              <View key={aj.jobId} style={styles.workerJobRow}>
                <Ionicons
                  name={PHASE_META[aj.phaseKey]?.icon || 'film-outline'}
                  size={13}
                  color={PHASE_META[aj.phaseKey]?.color || palette.accent}
                />
                <Text style={styles.workerJobText} numberOfLines={1}>
                  {aj.mine ? `${t('schedules.mineTag')} ` : ''}
                  {t(`schedules.desc.${aj.phaseKey}`, {
                    name: aj.projectName || t('schedules.untitled'),
                  })}
                </Text>
                {aj.phaseKey === 'render' ? (
                  <Text style={styles.workerJobPct}>{Math.round(aj.progress)}%</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SummaryStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function InfoCard({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.infoCard}>
      <Ionicons name={icon} size={30} color={palette.textDim} />
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoBody}>{body}</Text>
      {children}
    </View>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 },
  list: { padding: 16, gap: 10 },
  center: { paddingVertical: 48, alignItems: 'center' },

  summaryRow: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700' },

  mineCard: {
    backgroundColor: palette.accentSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.accent,
    padding: 16,
    gap: 4,
  },
  mineHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mineTitle: { color: palette.accent, fontSize: 13, fontWeight: '800' },
  mineAhead: { color: palette.text, fontSize: 20, fontWeight: '900' },
  mineEta: { color: palette.text, fontSize: 14, fontWeight: '700' },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  notifyHint: { color: palette.textDim, fontSize: 11 },

  section: { gap: 8 },
  sectionTitle: { color: palette.text, fontSize: 14, fontWeight: '800' },
  sectionEmpty: { color: palette.textDim, fontSize: 13 },

  workerCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  workerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerIconBusy: { backgroundColor: palette.accentSoft },
  workerName: { color: palette.text, fontSize: 14, fontWeight: '800', flex: 1 },
  workerRole: { color: palette.textDim, fontSize: 12, lineHeight: 17 },
  workerCap: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  workerJobs: {
    marginTop: 6,
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 8,
  },
  workerJobRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  workerJobText: { color: palette.text, fontSize: 12, flex: 1 },
  workerJobPct: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  rowMine: { borderColor: palette.accent, backgroundColor: palette.surfaceHigh },
  posBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posBadgeMine: { backgroundColor: palette.accent },
  posText: { color: palette.textDim, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  posTextMine: { color: '#fff' },
  rowBody: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowDesc: { color: palette.textDim, fontSize: 13, fontWeight: '700', flex: 1, lineHeight: 18 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipText: { fontSize: 11, fontWeight: '800' },
  barTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.surfaceHigh,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },
  rowMeta: { color: palette.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },

  infoCard: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  infoTitle: { color: palette.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  infoBody: { color: palette.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: palette.accent,
  },
  retryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
