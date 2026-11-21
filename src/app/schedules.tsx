import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JobRow } from '@/components/schedules/JobRow';
import { InfoCard, SummaryStat } from '@/components/schedules/ScheduleCards';
import { styles } from '@/components/schedules/schedulesStyles';
import { WorkerCard } from '@/components/schedules/WorkerCard';
import { palette } from '@/constants/editor';
import { formatEta } from '@/lib/progress';
import { fetchRenderQueue, type RenderQueue } from '@/lib/schedules';
import { countJobs } from '@/lib/schedulesScreenOps';
import { logCaught } from '@/lib/logCaught';

const POLL_MS = 4000;

/**
 * 🗓️ A felhő-render sor képernyője: a gyökér a betöltést, a fókuszban futó időzített
 * frissítést és a kompozíciót tartja; a sor-, worker- és info-kártyák a
 * src/components/schedules/ alatt.
 */
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
      logCaught('app/schedules.tsx:load', e);
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
  const activeCount = countJobs(jobs, 'active');
  const waitingCount = countJobs(jobs, 'waiting');

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
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={10} style={styles.backBtn}>
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
