import type { TFunction } from 'i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/admin/adminStyles';
import type { AppealRow } from '@/lib/appeals';
import type { ReportRow } from '@/lib/reports';

/**
 * 🚩 Bejelentések + 🟡 fellebbezések elbírálása (REFACTOR: a src/app/admin.tsx-ből).
 * Csak `report.review` joggal renderelődik — a kapu a gyökérben van.
 */
export function ReportReviewSection({
  t,
  reports,
  appeals,
  doRemoveReported,
  doRemoveReportedComment,
  doResolve,
  doResolveAppeal,
}: {
  t: TFunction;
  reports: ReportRow[];
  appeals: AppealRow[];
  doRemoveReported: (rep: ReportRow) => void;
  doRemoveReportedComment: (rep: ReportRow) => void;
  doResolve: (id: string, status: 'resolved' | 'dismissed') => void;
  doResolveAppeal: (app: AppealRow, decision: 'granted' | 'denied') => void;
}) {
  return (
    <>
      <Text style={styles.section}>{t('admin.reports')}</Text>
      {reports.length === 0 ? (
        <Text style={styles.dim}>{t('admin.noReports')}</Text>
      ) : (
        reports.map((rep) => (
          <View key={rep.id} style={styles.roleCard}>
            <Text style={styles.roleTitle}>
              {t(`report.reason_${rep.reason}`, { defaultValue: rep.reason })}{' '}
              <Text style={styles.roleSlug}>· {rep.targetType}</Text>
            </Text>
            {rep.note ? <Text style={styles.permDesc}>{rep.note}</Text> : null}
            {rep.targetType === 'message' && rep.messageBody ? (
              <Text style={styles.permDesc} numberOfLines={4}>
                {rep.messageSender ? `${rep.messageSender}: ` : ''}
                {`"${rep.messageBody}"`}
              </Text>
            ) : null}
            <View style={styles.reportActions}>
              {rep.targetType === 'post' ? (
                <Pressable
                  style={[styles.reportBtn, styles.reportRemove]}
                  onPress={() => doRemoveReported(rep)}
                >
                  <Text style={styles.reportBtnText}>{t('admin.reportRemove')}</Text>
                </Pressable>
              ) : null}
              {rep.targetType === 'comment' ? (
                <Pressable
                  style={[styles.reportBtn, styles.reportRemove]}
                  onPress={() => doRemoveReportedComment(rep)}
                >
                  <Text style={styles.reportBtnText}>{t('admin.reportRemoveComment')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.reportBtn, styles.reportResolve]}
                onPress={() => doResolve(rep.id, 'resolved')}
              >
                <Text style={styles.reportBtnText}>{t('admin.reportResolve')}</Text>
              </Pressable>
              <Pressable
                style={[styles.reportBtn, styles.reportDismiss]}
                onPress={() => doResolve(rep.id, 'dismissed')}
              >
                <Text style={styles.reportBtnTextDim}>{t('admin.reportDismiss')}</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      {/* — 🟡 Fellebbezések (report.review): eltávolított poszt visszaállítása — */}
      <Text style={styles.section}>{t('admin.appeals')}</Text>
      {appeals.length === 0 ? (
        <Text style={styles.dim}>{t('admin.noAppeals')}</Text>
      ) : (
        appeals.map((app) => (
          <View key={app.id} style={styles.roleCard}>
            <Text style={styles.roleTitle} numberOfLines={1}>
              {app.postTitle || app.postId.slice(0, 8)}
            </Text>
            {app.postDescription ? (
              <Text style={styles.permDesc} numberOfLines={2}>
                {app.postDescription}
              </Text>
            ) : null}
            {app.note ? <Text style={styles.permDesc}>{`"${app.note}"`}</Text> : null}
            <View style={styles.reportActions}>
              <Pressable
                style={[styles.reportBtn, styles.reportResolve]}
                onPress={() => doResolveAppeal(app, 'granted')}
              >
                <Text style={styles.reportBtnText}>{t('admin.appealGrant')}</Text>
              </Pressable>
              <Pressable
                style={[styles.reportBtn, styles.reportDismiss]}
                onPress={() => doResolveAppeal(app, 'denied')}
              >
                <Text style={styles.reportBtnTextDim}>{t('admin.appealDeny')}</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </>
  );
}
