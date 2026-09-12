import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { personaLabel } from '@/lib/aiPersona';
import {
  listAiProviders,
  listTaskAssignments,
  setTaskAssignment,
  type AiProvider,
  type AiTask,
} from '@/lib/aiProviders';

/**
 * 🤖 Provider-választó egy adott AI-feladathoz — a felhasználó MINDEN AI-
 * művelethez ITT, helyben választja meg, MELYIK saját AI-modelljével fusson
 * (BYOK). A választás feladatonként perzisztál (`user_ai_task_providers`), és a
 * hívás az `aiConfigForTask(task)`-on át oda irányul. Mivel feladatonként külön
 * kulcs mehet, a különböző AI-műveletek párhuzamosan is futhatnak.
 *
 * Ha a felhasználónak nincs saját providere, a picker NEM jelenik meg (nincs mit
 * választani — az alapértelmezett/worker-AI fut).
 */
export function AiProviderPicker({ task }: { task: AiTask }) {
  const { t } = useTranslation();
  const [models, setModels] = useState<AiProvider[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listAiProviders(), listTaskAssignments()])
      .then(([list, tasks]) => {
        if (alive) {
          setModels(list);
          setSelected(tasks[task] ?? null);
        }
      })
      .catch(() => {
        // nincs backend / bejelentkezés → nincs választó, marad az Auto
      });
    return () => {
      alive = false;
    };
  }, [task]);

  // választás — optimista + perzisztálva (a következő betöltés a szervert tükrözi)
  const pick = (id: string | null) => {
    setSelected(id);
    setTaskAssignment(task, id).catch(() => {});
  };

  if (models.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('aiPicker.model')}</Text>
      <View style={styles.row}>
        <Chip label={t('aiPicker.auto')} active={!selected} onPress={() => pick(null)} />
        {models.map((m) => (
          <Chip
            key={m.id}
            label={personaLabel(m) ?? m.label}
            active={selected === m.id}
            onPress={() => pick(m.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 5,
    marginBottom: 8,
  },
  label: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
