import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { AiCommandPartition } from '@/lib/aiCommands';
import { describeAiPlan } from '@/lib/aiPlan';
import type { AiPlanItem } from '@/lib/aiPlan';
import type { Project } from '@/types/project';

/**
 * 🤖 Az AI-javaslat: üzenet, a kiszűrt parancsok okkal, a feloldott terv-diff
 * (▶ előnézet), és a jóváhagyás / before-after preview / elvetés gombjai.
 * A `plan` és a `planProject` a panel renderében, a store-ból olvasva érkezik.
 */
export function SuggestionSection({
  message,
  plan,
  planProject,
  previewing,
  previewPlanItem,
  keepPreview,
  revertPreview,
  previewAll,
  apply,
  discard,
}: {
  message: string;
  plan: AiCommandPartition | null;
  planProject: Project | null;
  previewing: boolean;
  previewPlanItem: (item: AiPlanItem) => void;
  keepPreview: () => void;
  revertPreview: () => void;
  previewAll: () => void;
  apply: () => void;
  discard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.assistant.sectionSuggestion')}>
      <Text style={styles.message}>{message}</Text>
      {/* 🚫 B17: ami a validáción kiesett / csonkult — okkal, hogy a jóváhagyott terv = a végrehajtás */}
      {plan && plan.rejected.length > 0 ? (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectHead}>
            {t('panels.assistant.rejectedHeader', { count: plan.rejected.length })}
          </Text>
          {plan.rejected.map((r, i) => (
            <Text key={i} style={styles.rejectRow}>
              • {r.command.type}: {t(`panels.assistant.reject_${r.code}`, { detail: r.detail ?? '' })}
            </Text>
          ))}
        </View>
      ) : null}
      {plan && plan.accepted.length > 0 ? (
        <>
          {/* 🤖 Terv-preview (control layer): tételes, FELOLDOTT diff — melyik
              klip, mi változik miről mire; ▶-vel a régióra ugorva alkalmazás ELŐTT */}
          <Text style={styles.changeHeader}>
            {t('panels.assistant.planHeader', { count: plan.accepted.length })}
          </Text>
          {describeAiPlan(
            plan.accepted,
            planProject!,
            t
          ).map((item, i) => (
            <View key={i} style={styles.planRow}>
              <View style={styles.planBody}>
                <Text style={styles.planTitle}>{item.title}</Text>
                {item.detail ? <Text style={styles.planDetail}>{item.detail}</Text> : null}
                {item.reason ? <Text style={styles.planReason}>💡 {item.reason}</Text> : null}
              </View>
              {item.time != null ? (
                <Pressable
                  style={styles.planJump}
                  onPress={() => previewPlanItem(item)}
                  hitSlop={8}
                >
                  <Ionicons name="eye-outline" size={14} color={palette.accent} />
                  <Text style={styles.planJumpText}>{t('panels.assistant.planPreview')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {previewing ? (
            <>
              <Text style={styles.note}>{t('panels.assistant.previewingNote')}</Text>
              <PrimaryButton
                icon="checkmark"
                label={t('panels.assistant.keepChanges')}
                onPress={keepPreview}
              />
              <Chip
                label={t('panels.assistant.revert')}
                active={false}
                onPress={revertPreview}
              />
            </>
          ) : (
            <>
              <Chip
                label={t('panels.assistant.previewAll')}
                active={false}
                onPress={previewAll}
              />
              <PrimaryButton
                icon="checkmark"
                label={t('panels.assistant.applyCommandsBtn', { count: plan.accepted.length })}
                onPress={apply}
              />
              <Text style={styles.note}>{t('panels.assistant.planApproveNote')}</Text>
            </>
          )}
        </>
      ) : null}
      {previewing ? null : (
        <Chip label={t('panels.assistant.discard')} active={false} onPress={discard} />
      )}
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  rejectBox: {
    borderWidth: 1,
    borderColor: palette.warning,
    borderRadius: 8,
    padding: 8,
    gap: 2,
    marginVertical: 6,
  },
  rejectHead: { color: palette.warning, fontSize: 12, fontWeight: '800' },
  rejectRow: { color: palette.textDim, fontSize: 12, lineHeight: 16 },
  message: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
  },
  changeHeader: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  planBody: {
    flex: 1,
    gap: 2,
  },
  planTitle: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
  },
  planDetail: {
    color: palette.textDim,
    fontSize: 12,
    lineHeight: 17,
  },
  planReason: {
    color: palette.accent,
    fontSize: 11,
    lineHeight: 16,
  },
  planJump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  planJumpText: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
