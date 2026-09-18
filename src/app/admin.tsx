import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import {
  assignRole,
  createRole,
  deleteRole,
  listPermissions,
  listRolePermissions,
  listRoles,
  listUsersWithRoles,
  setRolePermission,
  type AppPermission,
  type AppRole,
  type UserWithRole,
} from '@/lib/roles';
import { useRoles } from '@/store/roleStore';

/**
 * 🛡️ Admin-panel — a globális szerep/jogosultság (RBAC) TESTRESZABÁSA:
 *  • szerep → jog mátrix (szerkeszthető, ha `role.manage`),
 *  • egyedi szerep létrehozása/törlése,
 *  • felhasználók szerep-kiosztása (ha `user.manage`).
 * A tartalom-kötött jogok (saját projekt/poszt) NEM itt élnek — azok az ownershipből.
 */
export default function AdminScreen() {
  const { t } = useTranslation();
  const canRole = useRoles((s) => s.permissions.includes('role.manage'));
  const canUser = useRoles((s) => s.permissions.includes('user.manage'));

  const [roles, setRoles] = useState<AppRole[]>([]);
  const [perms, setPerms] = useState<AppPermission[]>([]);
  const [pairs, setPairs] = useState<Set<string>>(new Set()); // `${role}|${perm}`
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const key = (role: string, perm: string) => `${role}|${perm}`;

  const load = useCallback(() => {
    // (nincs szinkron setLoading az effektben — a kezdő `loading` már true; a
    // finally kapcsolja ki. Újratöltéskor spinner nélkül frissül.)
    Promise.all([listRoles(), listPermissions(), listRolePermissions(), canUser ? listUsersWithRoles() : Promise.resolve([])])
      .then(([r, p, rp, u]) => {
        setRoles(r);
        setPerms(p);
        setPairs(new Set(rp.map((x) => key(x.role, x.permission))));
        setUsers(u);
      })
      .catch((e: unknown) => Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [canUser, t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (role: string, perm: string) => {
    const k = key(role, perm);
    const on = !pairs.has(k);
    // optimista
    setPairs((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
    setRolePermission(role, perm, on).catch((e: unknown) => {
      // visszagörgetés
      setPairs((prev) => {
        const next = new Set(prev);
        if (on) next.delete(k);
        else next.add(k);
        return next;
      });
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
      .catch((e: unknown) => Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)));
  };

  const removeRole = (role: AppRole) => {
    Alert.alert(t('admin.deleteRoleTitle'), role.label, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteRole(role.slug).then(load).catch((e: unknown) => Alert.alert(t('common.error'), String(e))),
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
              .then(() => setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: r.slug } : x))))
              .catch((e: unknown) => Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)));
          },
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ]
    );
  };

  if (!canRole && !canUser) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header t={t} />
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={40} color={palette.border} />
          <Text style={styles.dim}>{t('admin.noAccess')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header t={t} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* — Szerep → jog mátrix — */}
          {canRole ? (
            <>
              <Text style={styles.section}>{t('admin.rolePerms')}</Text>
              {roles.map((role) => (
                <View key={role.slug} style={styles.roleCard}>
                  <View style={styles.roleHead}>
                    <Text style={styles.roleTitle}>
                      {role.label} <Text style={styles.roleSlug}>· {role.slug}</Text>
                    </Text>
                    {!role.isSystem ? (
                      <Pressable onPress={() => removeRole(role)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={16} color={palette.textDim} />
                      </Pressable>
                    ) : null}
                  </View>
                  {perms.map((p) => {
                    const on = pairs.has(key(role.slug, p.key));
                    return (
                      <Pressable key={p.key} style={styles.permRow} onPress={() => toggle(role.slug, p.key)}>
                        <View style={styles.permText}>
                          <Text style={styles.permLabel}>{p.label}</Text>
                          {p.description ? <Text style={styles.permDesc}>{p.description}</Text> : null}
                        </View>
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={on ? palette.accent : palette.border}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              {/* — Egyedi szerep — */}
              <Text style={styles.section}>{t('admin.newRole')}</Text>
              <View style={styles.newRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={newSlug}
                  onChangeText={setNewSlug}
                  placeholder={t('admin.roleSlug')}
                  placeholderTextColor={palette.textDim}
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={newLabel}
                  onChangeText={setNewLabel}
                  placeholder={t('admin.roleLabel')}
                  placeholderTextColor={palette.textDim}
                />
                <Pressable style={styles.addBtn} onPress={addRole}>
                  <Ionicons name="add" size={22} color="#fff" />
                </Pressable>
              </View>
            </>
          ) : null}

          {/* — Felhasználók szerepe — */}
          {canUser ? (
            <>
              <Text style={styles.section}>{t('admin.users')}</Text>
              {users.map((u) => (
                <Pressable key={u.id} style={styles.userRow} onPress={() => changeUserRole(u)}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {u.name}
                  </Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>
                      {roles.find((r) => r.slug === u.role)?.label ?? u.role}
                    </Text>
                    <Ionicons name="chevron-down" size={13} color={palette.textDim} />
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Header({ t }: { t: (k: string) => string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 32 }}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{t('admin.title')}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  dim: { color: palette.textDim, fontSize: 15 },
  scroll: { padding: 14, paddingBottom: 48, gap: 8 },
  section: { color: palette.text, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 4 },
  roleCard: {
    backgroundColor: palette.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    marginBottom: 8,
  },
  roleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  roleTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  roleSlug: { color: palette.textDim, fontSize: 12, fontWeight: '500' },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  permText: { flex: 1 },
  permLabel: { color: palette.text, fontSize: 14, fontWeight: '600' },
  permDesc: { color: palette.textDim, fontSize: 12, marginTop: 1 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: palette.text,
    fontSize: 14,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
    gap: 10,
  },
  userName: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleBadgeText: { color: palette.text, fontSize: 12, fontWeight: '700' },
});
