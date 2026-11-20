import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { QUICK_ACTIONS } from '@/lib/assistantPanelOps';

/** 💬 „Mit csináljak?" — szabad utasítás + gyors-műveletek az AI-asszisztensnek */
export function InstructionSection({
  instruction,
  setInstruction,
  status,
  send,
}: {
  instruction: string;
  setInstruction: (text: string) => void;
  status: string | null;
  send: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.assistant.sectionWhatToDo')}>
      <TextInput
        value={instruction}
        onChangeText={setInstruction}
        multiline
        style={styles.input}
        placeholder={t('panels.assistant.instructionPlaceholder')}
        placeholderTextColor={palette.textDim}
      />
      <PrimaryButton
        icon="sparkles-outline"
        label={status ?? t('panels.assistant.sendToAssistant')}
        onPress={() => {
          if (instruction.trim()) {
            send(instruction.trim());
          }
        }}
      />
      <View style={styles.row}>
        {QUICK_ACTIONS.map((action) => {
          const actionLabel = t(`panels.assistant.quickAction_${action}`);
          // egyes műveletek a labelnél GAZDAGABB utasítást küldenek (pl. „tedd
          // ütősebbé" → több-lépéses terv); ha nincs ilyen kulcs, a label megy
          const instructionText = t(`panels.assistant.quickActionText_${action}`, {
            defaultValue: actionLabel,
          });
          return (
            <Chip
              key={action}
              label={actionLabel}
              active={false}
              onPress={() => send(instructionText)}
            />
          );
        })}
      </View>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
});
