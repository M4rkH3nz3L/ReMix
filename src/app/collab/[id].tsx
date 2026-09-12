import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
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

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  changeRole,
  currentUserId,
  ensureShared,
  inviteMember,
  leaveProject,
  pullSharedProject,
  removeMember,
  type CollabRole,
} from '@/lib/collab';
import { saveProject, loadProject } from '@/lib/storage';
import { guardPro } from '@/store/paywallStore';
import { useCollab } from '@/store/collabStore';
import type { Project } from '@/types/project';

const ROLE_COLOR: Record<CollabRole, string> = {
  owner: palette.accent,
  editor: palette.accent2,
  viewer: palette.textDim,
};

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? name[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

export default function CollabScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string; owner?: string }>();
  const projectId = params.id;
  const me = currentUserId();
  const ownerId = params.owner ?? me ?? '';

  const { members, role, loading, error, open, close, refresh } = useCollab();
  const [localProject, setLocalProject] = useState<Project | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<CollabRole, 'owner'>>('editor');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ownerId && projectId) {
      void open(ownerId, projectId);
    }
    return () => close();
  }, [ownerId, projectId, open, close]);

  // a tulaj lokális projektje kell a megosztás bekapcsolásához (név + JSON)
  useEffect(() => {
    if (ownerId === me && projectId) {
      loadProject(projectId).then(setLocalProject).catch(() => {});
    }
  }, [ownerId, me, projectId]);

  const isOwner = role === 'owner';
  const shared = members.length > 0;
  const projectName =
    members.find((m) => m.role === 'owner')?.projectName ?? localProject?.name ?? projectId;

  const onError = useCallback(
    (e: Error) => Alert.alert(t('common.error'), e.message),
    [t]
  );

  // 🔗 megosztás bekapcsolása (tulaj, Pro) — felhő-mentés + tulaj tag-sor
  const enableSharing = () => {
    if (!localProject) {
      return;
    }
    setBusy(true);
    void guardPro(async () => {
      await ensureShared(localProject);
      await refresh();
    }, onError).finally(() => setBusy(false));
  };

  // ➕ meghívás e-mail alapján
  const doInvite = () => {
    const addr = email.trim().toLowerCase();
    if (!addr || !addr.includes('@')) {
      Alert.alert(t('collab.invite.title'), t('collab.invite.badEmail'));
      return;
    }
    setBusy(true);
    void guardPro(async () => {
      const res = await inviteMember({ ownerId, projectId, projectName, email: addr, role: inviteRole });
      setEmail('');
      await refresh();
      if (res.status === 'added') {
        Alert.alert(t('collab.invite.title'), t('collab.invite.added', { email: addr }));
      } else if (res.status === 'pending') {
        Alert.alert(t('collab.invite.title'), t('collab.invite.pending', { email: addr }));
      } else {
        Alert.alert(t('collab.invite.title'), t('collab.invite.self'));
      }
    }, onError).finally(() => setBusy(false));
  };

  const toggleRole = (memberId: string, current: CollabRole) => {
    const next: CollabRole = current === 'editor' ? 'viewer' : 'editor';
    changeRole(ownerId, projectId, memberId, next)
      .then(refresh)
      .catch(onError);
  };

  const confirmRemove = (memberId: string, name: string) => {
    Alert.alert(t('collab.remove.title'), t('collab.remove.msg', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('collab.remove.confirm'),
        style: 'destructive',
        onPress: () => removeMember(ownerId, projectId, memberId).then(refresh).catch(onError),
      },
    ]);
  };

  const confirmLeave = () => {
    Alert.alert(t('collab.leave.title'), t('collab.leave.msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('collab.leave.confirm'),
        style: 'destructive',
        onPress: () =>
          leaveProject(ownerId, projectId)
            .then(() => router.back())
            .catch(onError),
      },
    ]);
  };

  // 📂 megosztott projekt megnyitása szerkesztőben (felhő → helyi mentés)
  const openInEditor = () => {
    setBusy(true);
    pullSharedProject(ownerId, projectId)
      .then(async (p) => {
        if (!p) {
          throw new Error(t('collab.open.failed'));
        }
        await saveProject(p);
        router.replace(`/editor/${projectId}`);
      })
      .catch(onError)
      .finally(() => setBusy(false));
  };

  const roleLabel = (r: CollabRole) => t(`collab.role.${r}`);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('collab.title')}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.projectName} numberOfLines={2}>
          {projectName}
        </Text>
        {role ? (
          <View style={[styles.roleBadge, { borderColor: ROLE_COLOR[role] }]}>
            <Text style={[styles.roleBadgeText, { color: ROLE_COLOR[role] }]}>
              {t('collab.youAre', { role: roleLabel(role) })}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : !shared && ownerId === me ? (
          // a tulaj még nem osztotta meg → bekapcsolás (Pro)
          <View style={styles.emptyCard}>
            <Ionicons name="people-circle-outline" size={40} color={palette.accent} />
            <Text style={styles.emptyTitle}>{t('collab.enable.title')}</Text>
            <Text style={styles.emptyHint}>{t('collab.enable.hint')}</Text>
            <PrimaryButton
              label={t('collab.enable.cta')}
              icon="cloud-upload-outline"
              onPress={enableSharing}
              disabled={busy || !localProject}
            />
          </View>
        ) : !shared ? (
          <Text style={styles.errorText}>{t('collab.noAccess')}</Text>
        ) : (
          <>
            {isOwner ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('collab.invite.title')}</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('collab.invite.placeholder')}
                  placeholderTextColor={palette.textDim}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                />
                <View style={styles.roleRow}>
                  <Chip
                    label={roleLabel('editor')}
                    active={inviteRole === 'editor'}
                    onPress={() => setInviteRole('editor')}
                    color={ROLE_COLOR.editor}
                  />
                  <Chip
                    label={roleLabel('viewer')}
                    active={inviteRole === 'viewer'}
                    onPress={() => setInviteRole('viewer')}
                    color={ROLE_COLOR.viewer}
                  />
                </View>
                <PrimaryButton
                  label={t('collab.invite.cta')}
                  icon="person-add-outline"
                  onPress={doInvite}
                  disabled={busy}
                />
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {t('collab.members', { count: members.length })}
              </Text>
              {members.map((m) => {
                const name = m.displayName || m.email || m.memberId.slice(0, 8);
                const isMe = m.memberId === me;
                const canManage = isOwner && m.role !== 'owner';
                return (
                  <View key={m.memberId} style={styles.memberRow}>
                    <View style={[styles.avatar, { backgroundColor: ROLE_COLOR[m.role] + '33' }]}>
                      <Text style={[styles.avatarText, { color: ROLE_COLOR[m.role] }]}>
                        {initials(name)}
                      </Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {name}
                        {isMe ? ` ${t('collab.you')}` : ''}
                      </Text>
                      {m.email && m.email !== name ? (
                        <Text style={styles.memberEmail} numberOfLines={1}>
                          {m.email}
                        </Text>
                      ) : null}
                    </View>
                    {canManage ? (
                      <Pressable
                        onPress={() => toggleRole(m.memberId, m.role)}
                        style={[styles.roleChip, { borderColor: ROLE_COLOR[m.role] }]}
                      >
                        <Text style={[styles.roleChipText, { color: ROLE_COLOR[m.role] }]}>
                          {roleLabel(m.role)}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={[styles.roleTag, { color: ROLE_COLOR[m.role] }]}>
                        {roleLabel(m.role)}
                      </Text>
                    )}
                    {canManage ? (
                      <Pressable
                        onPress={() => confirmRemove(m.memberId, name)}
                        hitSlop={8}
                        style={styles.removeBtn}
                      >
                        <Ionicons name="close" size={18} color={palette.danger} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* megosztott projekt (nem én vagyok a tulaj) — megnyitás + kilépés */}
            {ownerId !== me && role ? (
              <View style={styles.section}>
                <PrimaryButton
                  label={t('collab.open.cta')}
                  icon="create-outline"
                  onPress={openInEditor}
                  disabled={busy}
                />
                <Pressable onPress={confirmLeave} style={styles.leaveBtn}>
                  <Ionicons name="exit-outline" size={16} color={palette.danger} />
                  <Text style={styles.leaveText}>{t('collab.leave.cta')}</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 84 },
  backText: { color: palette.text, fontSize: 16 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 17, fontWeight: '800' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  projectName: { color: palette.text, fontSize: 20, fontWeight: '800' },
  roleBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  roleBadgeText: { fontSize: 12, fontWeight: '700' },
  loadingBox: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: palette.danger, fontSize: 14, fontWeight: '600', paddingVertical: 12 },
  emptyCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: '800' },
  emptyHint: { color: palette.textDim, fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 6 },
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
  roleRow: { flexDirection: 'row', gap: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800' },
  memberInfo: { flex: 1 },
  memberName: { color: palette.text, fontSize: 15, fontWeight: '600' },
  memberEmail: { color: palette.textDim, fontSize: 12 },
  roleChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleChipText: { fontSize: 12, fontWeight: '700' },
  roleTag: { fontSize: 12, fontWeight: '700' },
  removeBtn: { padding: 4 },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  leaveText: { color: palette.danger, fontSize: 14, fontWeight: '700' },
});
