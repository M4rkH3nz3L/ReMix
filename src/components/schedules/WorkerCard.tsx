import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { DONE_GREEN, PHASE_META, type IconName } from '@/components/schedules/scheduleMeta';
import { styles } from '@/components/schedules/schedulesStyles';
import { palette } from '@/constants/editor';
import type { RenderWorker } from '@/lib/schedules';
import { workerShortId } from '@/lib/schedulesScreenOps';

/** 🖥️ Egy render-worker kártyája: szerep, állapot, kapacitás, futó feladatai. */
export function WorkerCard({ worker }: { worker: RenderWorker }) {
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
            {t('schedules.workerName', { role, id: workerShortId(worker) })}
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
