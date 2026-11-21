import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/admin/adminStyles';
import { palette } from '@/constants/editor';
import { roleLabelOf } from '@/lib/adminScreenOps';
import type { AppRole, UserWithRole } from '@/lib/roles';

/**
 * 👥 A felhasználók szerepe — koppintásra szerep-választó (REFACTOR: a src/app/admin.tsx-ből).
 * Csak `user.manage` joggal renderelődik — a kapu a gyökérben van.
 */
export function UserRoleList({
  t,
  users,
  roles,
  changeUserRole,
}: {
  t: TFunction;
  users: UserWithRole[];
  roles: AppRole[];
  changeUserRole: (u: UserWithRole) => void;
}) {
  return (
    <>
      <Text style={styles.section}>{t('admin.users')}</Text>
      {users.map((u) => (
        <Pressable key={u.id} style={styles.userRow} onPress={() => changeUserRole(u)}>
          <Text style={styles.userName} numberOfLines={1}>
            {u.name}
          </Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {roleLabelOf(roles, u.role)}
            </Text>
            <Ionicons name="chevron-down" size={13} color={palette.textDim} />
          </View>
        </Pressable>
      ))}
    </>
  );
}
