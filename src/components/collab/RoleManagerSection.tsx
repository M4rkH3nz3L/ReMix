import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { saveProjectRoles } from '@/lib/collab';
import {
  makeRoleId,
  OWNER_ROLE_ID,
  PROJECT_PERMISSIONS,
  removeProjectRole,
  upsertProjectRole,
  type ProjectPermission,
  type ProjectRole,
} from '@/lib/projectRoles';

/**
 * 🔑 Szerepkörök kezelése (tulaj): a projekt role-jait és a hozzájuk tartozó
 * jogokat ITT definiálja a tulaj — a tagok és a projekt-szoba (chat) EZEKET
 * öröklik. Az owner nem módosítható; a beépítettek nem törölhetők; a view jog
 * minden role-ban benne marad (nézet nélkül nincs értelme a tagságnak).
 */

export function RoleManagerSection({
  ownerId,
  projectId,
  roles,
  memberRoleIds,
  onChanged,
}: {
  ownerId: string;
  projectId: string;
  roles: ProjectRole[];
  memberRoleIds: string[];
  onChanged: (roles: ProjectRole[]) => void;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const persist = (next: ProjectRole[]) => {
    setBusy(true);
    saveProjectRoles(ownerId, projectId, next)
      .then(() => onChanged(next))
      .catch((e: Error) => Alert.alert(t('common.error'), e.message))
      .finally(() => setBusy(false));
  };

  const togglePermission = (role: ProjectRole, perm: ProjectPermission) => {
    const permissions = role.permissions.includes(perm)
      ? role.permissions.filter((p) => p !== perm)
      : [...role.permissions, perm];
    const res = upsertProjectRole(roles, { ...role, permissions });
    if (res.ok) {
      persist(res.roles);
    }
  };

  const addRole = () => {
    const res = upsertProjectRole(roles, {
      id: makeRoleId(Date.now()),
      name: newName,
      permissions: ['view', 'chat'],
    });
    if (!res.ok) {
      Alert.alert(t('common.error'), t('collab.roles.invalidName'));
      return;
    }
    setNewName('');
    persist(res.roles);
  };

  const deleteRole = (role: ProjectRole) => {
    const res = removeProjectRole(roles, role.id, memberRoleIds);
    if (!res.ok) {
      Alert.alert(
        t('collab.roles.title'),
        res.reason === 'in_use' ? t('collab.roles.inUse') : t('collab.roles.builtin'),
      );
      return;
    }
    persist(res.roles);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('collab.roles.title')}</Text>
      <Text style={styles.hint}>{t('collab.roles.hint')}</Text>
      {roles.map((role) => (
        <View key={role.id} style={styles.roleBlock}>
          <View style={styles.roleHead}>
            <Text style={styles.roleName}>
              {role.name}
              {role.builtin ? ` · ${t('collab.roles.builtinTag')}` : ''}
            </Text>
            {!role.builtin ? (
              <Pressable onPress={() => deleteRole(role)} hitSlop={8}>
                <Ionicons name="trash-outline" size={15} color={palette.danger} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.permRow}>
            {PROJECT_PERMISSIONS.map((perm) => (
              <Chip
                key={perm}
                label={t(`collab.perm.${perm}`)}
                active={role.permissions.includes(perm)}
                onPress={
                  // az owner fix; a view minden role-ban kötelező (a mag is kikényszeríti)
                  role.id === OWNER_ROLE_ID || perm === 'view' || busy
                    ? () => {}
                    : () => togglePermission(role, perm)
                }
              />
            ))}
          </View>
        </View>
      ))}
      <TextInput
        style={styles.input}
        value={newName}
        onChangeText={setNewName}
        placeholder={t('collab.roles.newPlaceholder')}
        placeholderTextColor={palette.textDim}
      />
      <PrimaryButton
        label={t('collab.roles.add')}
        icon="add-circle-outline"
        onPress={addRole}
        disabled={busy || newName.trim().length === 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 17 },
  roleBlock: { gap: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  roleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleName: { color: palette.text, fontSize: 14, fontWeight: '700' },
  permRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
  },
});
