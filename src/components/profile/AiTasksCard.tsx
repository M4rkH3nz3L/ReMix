import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { AvatarSvg } from '@/components/AvatarSvg';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { examAllowsTask } from '@/lib/aiExam';
import { AI_TASKS, type AiProvider, type AiTask } from '@/lib/aiProviders';
import { profileStyles as styles } from './styles';

/**
 * 🤖 AI-modellek feladatonként (mátrix): minden feladathoz Auto (null) VAGY egy konkrét
 * provider választható chipekkel. 🔒 Cél-szűrés (local-ai 5.2/5.3): egy feladatra
 * csak a rá bevizsgázott provider választható — a ki nem vizsgázott itt meg sem
 * jelenik (a futásidejű kaput az `aiConfigForTask` amúgy is tartja).
 * Prezentációs — a kiválasztó handler propból jön.
 */
export function AiTasksCard({
  providers,
  taskAssign,
  onPickTask,
}: {
  providers: AiProvider[];
  taskAssign: Partial<Record<AiTask, string>>;
  onPickTask: (task: AiTask, providerId: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.aiTasksSection')}</Text>
      <Text style={styles.sectionHint}>{t('profile.aiTasksHint')}</Text>
      <View style={styles.card}>
        {providers.length === 0 ? (
          <Text style={styles.emptyText}>{t('profile.aiTasksNoModels')}</Text>
        ) : (
          AI_TASKS.map((task) => (
            <View key={task} style={styles.taskRow}>
              <Text style={styles.taskLabel}>{t('profile.task_' + task)}</Text>
              <View style={styles.taskChips}>
                <Chip
                  label={t('aiPicker.auto')}
                  leading={
                    <Ionicons
                      name="flash"
                      size={13}
                      color={!taskAssign[task] ? palette.text : palette.textDim}
                    />
                  }
                  active={!taskAssign[task]}
                  onPress={() => onPickTask(task, null)}
                />
                {providers
                  .filter((p) => examAllowsTask(p, task))
                  .map((p) => (
                    <Chip
                      key={p.id}
                      label={p.label}
                      leading={<AvatarSvg config={p.avatar} size={18} />}
                      active={taskAssign[task] === p.id}
                      onPress={() => onPickTask(task, p.id)}
                    />
                  ))}
              </View>
            </View>
          ))
        )}
      </View>
    </>
  );
}
