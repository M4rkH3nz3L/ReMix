import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { PHASE_META, STATE_META } from '@/components/schedules/scheduleMeta';
import { styles } from '@/components/schedules/schedulesStyles';
import { palette } from '@/constants/editor';
import { formatEta } from '@/lib/progress';
import type { RenderJob } from '@/lib/schedules';
import { cap, progressBarWidth } from '@/lib/schedulesScreenOps';

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

export function JobRow({ job }: { job: RenderJob }) {
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
                { width: progressBarWidth(job.progress), backgroundColor: chip.color },
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
