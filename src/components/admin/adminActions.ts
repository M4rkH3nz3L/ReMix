import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { rolePermKey, withPair, withUserRole } from '@/lib/adminScreenOps';
import { resolveAppeal, type AppealRow } from '@/lib/appeals';
import { logCaught } from '@/lib/logCaught';
import { resolveReport, type ReportRow } from '@/lib/reports';
import {
  assignRole,
  createRole,
  deleteRole,
  moderateCommentGlobal,
  moderatePostGlobal,
  setRolePermission,
  setUserSuspended,
  type AppRole,
  type UserWithRole,
} from '@/lib/roles';

/**
 * Az admin-panel hook nélküli akció-gyára (REFACTOR: a src/app/admin.tsx-ből): jog-kapcsoló
 * (optimista + visszagörgetés), egyedi szerep, szerep-kiosztás, felfüggesztés, bejelentések és
 * fellebbezések. A jogosultság-ellenőrzés (`can*`) a gyökérben marad; ide csak a `canSuspend`
 * jön, a szerep-választó gombjaihoz. A logCaught-címkék az eredeti fájl ujjlenyomatai.
 */
export interface AdminActionDeps {
  t: TFunction;
  pairs: Set<string>;
  roles: AppRole[];
  newSlug: string;
  newLabel: string;
  canSuspend: boolean;
  load: () => void;
  setPairs: Dispatch<SetStateAction<Set<string>>>;
  setUsers: Dispatch<SetStateAction<UserWithRole[]>>;
  setReports: Dispatch<SetStateAction<ReportRow[]>>;
  setAppeals: Dispatch<SetStateAction<AppealRow[]>>;
  setNewSlug: Dispatch<SetStateAction<string>>;
  setNewLabel: Dispatch<SetStateAction<string>>;
}

export function createAdminActions({
  t,
  pairs,
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
}: AdminActionDeps) {
  const toggle = (role: string, perm: string) => {
    const k = rolePermKey(role, perm);
    const on = !pairs.has(k);
    // optimista
    setPairs((prev) => withPair(prev, k, on));
    setRolePermission(role, perm, on).catch((e: unknown) => {
      logCaught('app/admin.tsx:toggle', e);
      // visszagörgetés
      setPairs((prev) => withPair(prev, k, !on));
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    });
  };

  const addRole = () => {
    if (!newSlug.trim()) {
      return;
    }
    createRole(newSlug, newLabel)
      .then(() => {
        setNewSlug('');
        setNewLabel('');
        load();
      })
      .catch((e: unknown) => { logCaught('app/admin.tsx:addRole', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); });
  };

  const removeRole = (role: AppRole) => {
    Alert.alert(t('admin.deleteRoleTitle'), role.label, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteRole(role.slug).then(load).catch((e: unknown) => { logCaught('app/admin.tsx:removeRole', e); return Alert.alert(t('common.error'), String(e)); }),
      },
    ]);
  };

  const changeUserRole = (u: UserWithRole) => {
    // körkörös léptetés a szerepeken (egyszerű választó, külön picker nélkül)
    Alert.alert(
      u.name,
      t('admin.pickRole'),
      [
        ...roles.map((r) => ({
          text: `${r.label}${r.slug === u.role ? ' ✓' : ''}`,
          onPress: () => {
            assignRole(u.id, r.slug)
              .then(() => setUsers((prev) => withUserRole(prev, u.id, r.slug)))
              .catch((e: unknown) => { logCaught('app/admin.tsx:changeUserRole', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); });
          },
        })),
        // 🚫 fiók-tiltás/feloldás (csak `user.suspend` birtokosnak)
        ...(canSuspend
          ? [
              { text: t('admin.suspend'), style: 'destructive' as const, onPress: () => doSuspend(u, true) },
              { text: t('admin.unsuspend'), onPress: () => doSuspend(u, false) },
            ]
          : []),
        { text: t('common.cancel'), style: 'cancel' as const },
      ]
    );
  };

  // 🚩 bejelentés lezárása (kezelve / elutasítva) — optimista
  const doResolve = (id: string, status: 'resolved' | 'dismissed') => {
    setReports((prev) => prev.filter((r) => r.id !== id));
    resolveReport(id, status).catch((e: unknown) => {
      logCaught('app/admin.tsx:doResolve', e);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      load();
    });
  };
  // 🚩 poszt-bejelentés kezelése: a poszt eltávolítása + a bejelentés lezárása
  const doRemoveReported = (rep: ReportRow) => {
    if (!rep.postId) {
      return;
    }
    moderatePostGlobal(rep.postId, 'removed')
      .then(() => doResolve(rep.id, 'resolved'))
      .catch((e: unknown) => { logCaught('app/admin.tsx:doRemoveReported', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); });
  };
  // 🚩 komment-bejelentés kezelése: a komment törlése (comment.moderate) + lezárás
  const doRemoveReportedComment = (rep: ReportRow) => {
    if (!rep.commentId) {
      return;
    }
    moderateCommentGlobal(rep.commentId)
      .then(() => doResolve(rep.id, 'resolved'))
      .catch((e: unknown) => { logCaught('app/admin.tsx:doRemoveReportedComment', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); });
  };
  // 🚫 fiók-felfüggesztés (user.suspend): a tiltott user nem tud belépni
  const doSuspend = (u: UserWithRole, suspended: boolean) => {
    const run = () =>
      setUserSuspended(u.id, suspended).catch((e: unknown) =>
        { logCaught('app/admin.tsx:run', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); }
      );
    if (suspended) {
      Alert.alert(t('admin.suspendTitle'), t('admin.suspendConfirm', { name: u.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('admin.suspend'), style: 'destructive', onPress: run },
      ]);
    } else {
      run();
    }
  };
  // 🟡 fellebbezés elbírálása: granted → a poszt visszaáll, denied → marad removed
  const doResolveAppeal = (app: AppealRow, decision: 'granted' | 'denied') => {
    setAppeals((prev) => prev.filter((a) => a.id !== app.id));
    resolveAppeal(app.id, app.postId, decision).catch((e: unknown) => {
      logCaught('app/admin.tsx:doResolveAppeal', e);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      load();
    });
  };

  return {
    toggle,
    addRole,
    removeRole,
    changeUserRole,
    doResolve,
    doRemoveReported,
    doRemoveReportedComment,
    doResolveAppeal,
  };
}
