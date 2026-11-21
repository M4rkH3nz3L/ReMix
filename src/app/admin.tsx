import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminHeader } from '@/components/admin/AdminHeader';
import { createAdminActions } from '@/components/admin/adminActions';
import { styles } from '@/components/admin/adminStyles';
import { FinanceReviewList } from '@/components/admin/FinanceReviewList';
import { PayoutReviewList } from '@/components/admin/PayoutReviewList';
import { ReportReviewSection } from '@/components/admin/ReportReviewSection';
import { RolePermissionMatrix } from '@/components/admin/RolePermissionMatrix';
import { UserRoleList } from '@/components/admin/UserRoleList';
import { palette } from '@/constants/editor';
import { rolePermKey } from '@/lib/adminScreenOps';
import { createInFlightLock } from '@/lib/asyncGuard';
import {
  listPermissions,
  listRolePermissions,
  listRoles,
  listUsersWithRoles,
  type AppPermission,
  type AppRole,
  type UserWithRole,
} from '@/lib/roles';
import { downloadDac7 } from '@/lib/wallet';
import { listOpenAppeals, type AppealRow } from '@/lib/appeals';
import { listOpenReports, type ReportRow } from '@/lib/reports';
import { useRoles } from '@/store/roleStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 🛡️ Admin-panel — a globális szerep/jogosultság (RBAC) TESTRESZABÁSA:
 *  • szerep → jog mátrix (szerkeszthető, ha `role.manage`),
 *  • egyedi szerep létrehozása/törlése,
 *  • felhasználók szerep-kiosztása (ha `user.manage`).
 * A tartalom-kötött jogok (saját projekt/poszt) NEM itt élnek — azok az ownershipből.
 * A gyökér tartja a jog-kapukat (`can*`), az állapotot és a betöltést; az akciók az
 * admin/adminActions.ts-ben, a szekciók a src/components/admin/ alatt (REFACTOR).
 */
export default function AdminScreen() {
  const { t } = useTranslation();
  const canRole = useRoles((s) => s.permissions.includes('role.manage'));
  const canUser = useRoles((s) => s.permissions.includes('user.manage'));
  const canReview = useRoles((s) => s.permissions.includes('report.review'));
  const canSuspend = useRoles((s) => s.permissions.includes('user.suspend'));
  const canPayouts = useRoles((s) => s.permissions.includes('payout.review'));
  const canFinance = useRoles((s) => s.permissions.includes('finance.manage'));

  const [roles, setRoles] = useState<AppRole[]>([]);
  const [perms, setPerms] = useState<AppPermission[]>([]);
  const [pairs, setPairs] = useState<Set<string>>(new Set()); // `${role}|${perm}`
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');
  // 🔒 szinkron, kulcsonkénti zár a dupla koppintás ellen (a render-kori állapot erre nem elég)
  const [inFlight] = useState(createInFlightLock);

  const load = useCallback(() => {
    // (nincs szinkron setLoading az effektben — a kezdő `loading` már true; a
    // finally kapcsolja ki. Újratöltéskor spinner nélkül frissül.)
    Promise.all([
      listRoles(),
      listPermissions(),
      listRolePermissions(),
      canUser ? listUsersWithRoles() : Promise.resolve([]),
      canReview ? listOpenReports() : Promise.resolve([]),
      canReview ? listOpenAppeals() : Promise.resolve([]),
    ])
      .then(([r, p, rp, u, rep, app]) => {
        setRoles(r);
        setPerms(p);
        setPairs(new Set(rp.map((x) => rolePermKey(x.role, x.permission))));
        setUsers(u);
        setReports(rep as ReportRow[]);
        setAppeals(app as AppealRow[]);
      })
      .catch((e: unknown) => { logCaught('app/admin.tsx:load', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); })
      .finally(() => setLoading(false));
  }, [canUser, canReview, t]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    toggle,
    addRole,
    removeRole,
    changeUserRole,
    doResolve,
    doRemoveReported,
    doRemoveReportedComment,
    doResolveAppeal,
  } = createAdminActions({
    t,
    pairs,
    inFlight,
    roles,
    newSlug,
    newLabel,
    canSuspend,
    load,
    setPairs,
    setUsers,
    setReports,
    setAppeals,
    setNewSlug,
    setNewLabel,
  });

  if (!canRole && !canUser && !canReview && !canPayouts && !canFinance) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <AdminHeader t={t} />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={40} color={palette.border} />
          <Text style={styles.dim}>{t('admin.noAccess')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <AdminHeader t={t} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* — Szerep → jog mátrix — */}
          {canRole ? (
            <RolePermissionMatrix
              t={t}
              roles={roles}
              perms={perms}
              pairs={pairs}
              removeRole={removeRole}
              toggle={toggle}
              newSlug={newSlug}
              setNewSlug={setNewSlug}
              newLabel={newLabel}
              setNewLabel={setNewLabel}
              addRole={addRole}
            />
          ) : null}

          {/* — Felhasználók szerepe — */}
          {canUser ? (
            <UserRoleList t={t} users={users} roles={roles} changeUserRole={changeUserRole} />
          ) : null}

          {/* — 🚩 Bejelentések (report.review) — */}
          {canReview ? (
            <ReportReviewSection
              t={t}
              reports={reports}
              appeals={appeals}
              doRemoveReported={doRemoveReported}
              doRemoveReportedComment={doRemoveReportedComment}
              doResolve={doResolve}
              doResolveAppeal={doResolveAppeal}
            />
          ) : null}

          {/* — Kifizetések kézi ellenőrzése (PRO-CASH C3.4) — */}
          {canPayouts ? <PayoutReviewList /> : null}

          {/* — Cégek jóváhagyása és átutalások (PRO-CASH C4.2/C4.4) — */}
          {canFinance ? <FinanceReviewList /> : null}

          {/* — DAC7-export (PRO-CASH C3.5) — az előző év eladói bevétele — */}
          {canFinance ? (
            <Pressable
              style={[styles.reportBtn, { marginTop: 18 }]}
              onPress={() => {
                if (!inFlight.tryAcquire('dac7')) {
                  return;
                }
                downloadDac7(new Date().getFullYear() - 1)
                  .catch((e: unknown) => {
                    logCaught('app/admin.tsx:dac7', e);
                    Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
                  })
                  .finally(() => inFlight.release('dac7'));
              }}
            >
              <Text style={styles.reportBtnTextDim}>{t('admin.dac7Export', { year: new Date().getFullYear() - 1 })}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
