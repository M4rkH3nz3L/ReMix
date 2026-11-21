import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/admin/adminStyles';
import { palette } from '@/constants/editor';
import { rolePermKey } from '@/lib/adminScreenOps';
import type { AppPermission, AppRole } from '@/lib/roles';

/**
 * 🛡️ Szerep → jog mátrix + egyedi szerep létrehozása (REFACTOR: a src/app/admin.tsx-ből).
 * Csak `role.manage` joggal renderelődik — a kapu a gyökérben van.
 */
export function RolePermissionMatrix({
  t,
  roles,
  perms,
  pairs,
  removeRole,
  toggle,
  newSlug,
  setNewSlug,
  newLabel,
  setNewLabel,
  addRole,
}: {
  t: TFunction;
  roles: AppRole[];
  perms: AppPermission[];
  pairs: Set<string>;
  removeRole: (role: AppRole) => void;
  toggle: (role: string, perm: string) => void;
  newSlug: string;
  setNewSlug: Dispatch<SetStateAction<string>>;
  newLabel: string;
  setNewLabel: Dispatch<SetStateAction<string>>;
  addRole: () => void;
}) {
  return (
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
            const on = pairs.has(rolePermKey(role.slug, p.key));
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
  );
}
