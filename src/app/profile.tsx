import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  isNonEmpty,
  isValidBirthday,
  isValidFullName,
  isValidPhone,
} from '@/lib/accountValidation';
import {
  AI_PROVIDER_KINDS,
  AI_TASKS,
  type AiProvider,
  type AiProviderKind,
  type AiTask,
  createAiProvider,
  deleteAiProvider,
  listAiProviders,
  listTaskAssignments,
  setDefaultAiProvider,
  setTaskAssignment,
  updateAiProvider,
} from '@/lib/aiProviders';
import { type AccountProfile, fetchProfile, saveProfile } from '@/lib/profile';
import { useAuth } from '@/store/authStore';

const PROVIDER_KINDS: AiProviderKind[] = ['openai', 'anthropic', 'ollama', 'custom'];
const PROVIDER_LABEL: Record<AiProviderKind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  custom: 'Custom',
};

interface ProviderForm {
  id: string | null; // null = új
  label: string;
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const EMPTY_FORM: ProviderForm = {
  id: null,
  label: '',
  provider: 'openai',
  baseUrl: '',
  model: '',
  apiKey: '',
};

/**
 * 👤 Profil — a bejelentkezett felhasználó adatai és beállításai.
 *  - Személyes adatok (profiles tábla)
 *  - AI-modellek (user_ai_providers): saját endpoint + kulcs (BYOK)
 *  - Kijelentkezés
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const configured = useAuth((s) => s.configured);
  const email = useAuth((s) => s.user?.email ?? '');
  const signOut = useAuth((s) => s.signOut);

  // configured=false esetén nincs mit tölteni → azonnal false (nem villog a spinner)
  const [loading, setLoading] = useState(configured);
  const [profile, setProfile] = useState<AccountProfile>({
    fullName: '',
    phone: '',
    birthday: '',
    country: '',
    city: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  // 🤖 feladat → provider hozzárendelések (a „AI-modellek feladatonként" mátrixhoz)
  const [taskAssign, setTaskAssign] = useState<Partial<Record<AiTask, string>>>({});

  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  // adatok betöltése/frissítése — promise-chain (a setState .then/.finally
  // callbackben fut, nem az effekt szinkron testében), fókuszkor újratölt
  const refresh = useCallback(() => {
    if (!configured) {
      return;
    }
    Promise.all([fetchProfile(), listAiProviders(), listTaskAssignments()])
      .then(([p, list, tasks]) => {
        setProfile(p);
        setProviders(list);
        setTaskAssign(tasks);
      })
      .catch((e: unknown) => {
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [configured, t]);

  useFocusEffect(refresh);

  // — személyes adatok —
  const setField = (key: keyof AccountProfile, value: string) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  const nameError = profile.fullName.length > 0 && !isValidFullName(profile.fullName);
  const phoneError = profile.phone.length > 0 && !isValidPhone(profile.phone);
  const birthdayError = profile.birthday.length > 0 && !isValidBirthday(profile.birthday);
  const profileValid =
    isValidFullName(profile.fullName) &&
    isValidPhone(profile.phone) &&
    isValidBirthday(profile.birthday) &&
    isNonEmpty(profile.country) &&
    isNonEmpty(profile.city);

  const onSaveProfile = async () => {
    if (!profileValid || savingProfile) {
      return;
    }
    setSavingProfile(true);
    try {
      await saveProfile(profile);
      Alert.alert(t('profile.savedTitle'), t('profile.profileSaved'));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProfile(false);
    }
  };

  // — AI-modellek —
  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };
  const openEdit = (p: AiProvider) => {
    setForm({
      id: p.id,
      label: p.label,
      provider: p.provider,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: p.apiKey,
    });
    setEditorOpen(true);
  };

  const kindMeta = AI_PROVIDER_KINDS[form.provider];
  const formValid =
    form.label.trim().length > 0 &&
    form.model.trim().length > 0 &&
    (form.provider !== 'custom' || form.baseUrl.trim().length > 0) &&
    (!kindMeta.needsKey || form.apiKey.trim().length > 0);

  const onSaveProvider = async () => {
    if (!formValid || savingProvider) {
      return;
    }
    setSavingProvider(true);
    const input = {
      label: form.label,
      provider: form.provider,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey,
    };
    try {
      if (form.id) {
        await updateAiProvider(form.id, input);
      } else {
        await createAiProvider(input);
      }
      setEditorOpen(false);
      refresh();
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProvider(false);
    }
  };

  const onDeleteProvider = (p: AiProvider) => {
    Alert.alert(p.label, t('profile.deleteModelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteAiProvider(p.id)
            .then(() => refresh())
            .catch((e: Error) => Alert.alert(t('common.error'), e.message));
        },
      },
    ]);
  };

  const onSetDefault = (p: AiProvider) => {
    if (p.isDefault) {
      return;
    }
    setDefaultAiProvider(p.id)
      .then(() => refresh())
      .catch((e: Error) => Alert.alert(t('common.error'), e.message));
  };

  // 🤖 feladat → provider választás (Auto = null); optimista + perzisztálva
  const pickTask = (task: AiTask, providerId: string | null) => {
    setTaskAssign((prev) => {
      const next = { ...prev };
      if (providerId) {
        next[task] = providerId;
      } else {
        delete next[task];
      }
      return next;
    });
    setTaskAssignment(task, providerId).catch((e: Error) =>
      Alert.alert(t('common.error'), e.message)
    );
  };

  const onSignOut = () => {
    Alert.alert(t('auth.account'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('profile.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : !configured ? (
        <View style={styles.loadingBox}>
          <Text style={styles.notConfigured}>{t('auth.notConfigured')}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* — Személyes adatok — */}
          <Text style={styles.sectionTitle}>{t('profile.personalSection')}</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>{t('auth.nameLabel')}</Text>
            <TextInput
              value={profile.fullName}
              onChangeText={(v) => setField('fullName', v)}
              placeholder={t('auth.namePlaceholder')}
              placeholderTextColor={palette.textDim}
              style={[styles.input, nameError && styles.inputError]}
              autoCapitalize="words"
            />
            {nameError ? <Text style={styles.error}>{t('auth.nameHint')}</Text> : null}

            <Text style={styles.fieldLabel}>{t('auth.phoneLabel')}</Text>
            <TextInput
              value={profile.phone}
              onChangeText={(v) => setField('phone', v)}
              placeholder={t('auth.phonePlaceholder')}
              placeholderTextColor={palette.textDim}
              style={[styles.input, phoneError && styles.inputError]}
              keyboardType="phone-pad"
            />
            {phoneError ? <Text style={styles.error}>{t('auth.phoneInvalid')}</Text> : null}

            <Text style={styles.fieldLabel}>{t('auth.birthdayLabel')}</Text>
            <TextInput
              value={profile.birthday}
              onChangeText={(v) => setField('birthday', v)}
              placeholder={t('auth.birthdayPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={[styles.input, birthdayError && styles.inputError]}
              autoCapitalize="none"
            />
            {birthdayError ? (
              <Text style={styles.error}>{t('auth.birthdayInvalid')}</Text>
            ) : null}

            <Text style={styles.fieldLabel}>{t('auth.locationLabel')}</Text>
            <TextInput
              value={profile.country}
              onChangeText={(v) => setField('country', v)}
              placeholder={t('auth.countryPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
            />
            <TextInput
              value={profile.city}
              onChangeText={(v) => setField('city', v)}
              placeholder={t('auth.cityPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
            />

            <View style={{ marginTop: 12 }}>
              {savingProfile ? (
                <View style={styles.busyBox}>
                  <ActivityIndicator color={palette.text} />
                </View>
              ) : (
                <PrimaryButton
                  icon="checkmark"
                  label={t('common.save')}
                  disabled={!profileValid}
                  onPress={() => {
                    void onSaveProfile();
                  }}
                />
              )}
            </View>
          </View>

          {/* — AI-modellek — */}
          <Text style={styles.sectionTitle}>{t('profile.aiSection')}</Text>
          <Text style={styles.sectionHint}>{t('profile.aiSectionHint')}</Text>
          <View style={styles.card}>
            {providers.length === 0 ? (
              <Text style={styles.emptyText}>{t('profile.noModels')}</Text>
            ) : (
              providers.map((p) => (
                <View key={p.id} style={styles.providerRow}>
                  <Pressable
                    style={styles.providerMain}
                    onPress={() => onSetDefault(p)}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={p.isDefault ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={p.isDefault ? palette.accent : palette.textDim}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.providerTitleRow}>
                        <Text style={styles.providerLabel} numberOfLines={1}>
                          {p.label}
                        </Text>
                        {p.isDefault ? (
                          <View style={styles.defaultBadge}>
                            <Text style={styles.defaultBadgeText}>
                              {t('profile.defaultBadge')}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.providerMeta} numberOfLines={1}>
                        {PROVIDER_LABEL[p.provider]} · {p.model || '—'}
                        {p.apiKey ? ' · 🔑' : ''}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => openEdit(p)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="create-outline" size={20} color={palette.textDim} />
                  </Pressable>
                  <Pressable onPress={() => onDeleteProvider(p)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={20} color={palette.danger} />
                  </Pressable>
                </View>
              ))
            )}
            <Pressable onPress={openNew} style={styles.addRow}>
              <Ionicons name="add-circle-outline" size={20} color={palette.accent} />
              <Text style={styles.addText}>{t('profile.addModel')}</Text>
            </Pressable>
          </View>

          {/* — AI-modellek feladatonként (mátrix) — */}
          <Text style={styles.sectionTitle}>{t('profile.aiTasksSection')}</Text>
          <Text style={styles.sectionHint}>{t('profile.aiTasksHint')}</Text>
          <View style={styles.card}>
            {providers.length === 0 ? (
              <Text style={styles.emptyText}>{t('profile.aiTasksNoModels')}</Text>
            ) : (
              AI_TASKS.map((task) => (
                <View key={task} style={styles.taskRow}>
                  <Text style={styles.taskLabel}>{t('profile.task_' + task)}</Text>
                  <View style={styles.taskChips}>
                    <Chip
                      label={t('aiPicker.auto')}
                      active={!taskAssign[task]}
                      onPress={() => pickTask(task, null)}
                    />
                    {providers.map((p) => (
                      <Chip
                        key={p.id}
                        label={p.label}
                        active={taskAssign[task] === p.id}
                        onPress={() => pickTask(task, p.id)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>

          {/* — Fiók — */}
          <Text style={styles.sectionTitle}>{t('profile.accountSection')}</Text>
          <View style={styles.card}>
            <Text style={styles.emailText}>{t('auth.signedInAs', { email })}</Text>
            <Pressable onPress={onSignOut} style={styles.signOutBtn}>
              <Ionicons name="log-out-outline" size={18} color={palette.danger} />
              <Text style={styles.signOutText}>{t('auth.signOut')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* — provider szerkesztő modal — */}
      <Modal visible={editorOpen} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalGrabber} />
            <Text style={styles.modalTitle}>
              {form.id ? t('profile.editModel') : t('profile.newModel')}
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              <Text style={styles.fieldLabel}>{t('profile.labelLabel')}</Text>
              <TextInput
                value={form.label}
                onChangeText={(v) => setForm((f) => ({ ...f, label: v }))}
                placeholder={t('profile.labelPlaceholder')}
                placeholderTextColor={palette.textDim}
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>{t('profile.providerLabel')}</Text>
              <View style={styles.chipRow}>
                {PROVIDER_KINDS.map((kind) => (
                  <Chip
                    key={kind}
                    label={PROVIDER_LABEL[kind]}
                    active={form.provider === kind}
                    onPress={() => setForm((f) => ({ ...f, provider: kind }))}
                  />
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t('profile.modelLabel')}</Text>
              <TextInput
                value={form.model}
                onChangeText={(v) => setForm((f) => ({ ...f, model: v }))}
                placeholder={kindMeta.sampleModel || t('profile.modelPlaceholder')}
                placeholderTextColor={palette.textDim}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>{t('profile.baseUrlLabel')}</Text>
              <TextInput
                value={form.baseUrl}
                onChangeText={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
                placeholder={kindMeta.defaultBaseUrl || t('profile.baseUrlPlaceholder')}
                placeholderTextColor={palette.textDim}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={styles.hint}>{t('profile.baseUrlHint')}</Text>

              <Text style={styles.fieldLabel}>{t('profile.apiKeyLabel')}</Text>
              <TextInput
                value={form.apiKey}
                onChangeText={(v) => setForm((f) => ({ ...f, apiKey: v }))}
                placeholder={
                  kindMeta.needsKey ? t('profile.apiKeyPlaceholder') : t('profile.apiKeyOptional')
                }
                placeholderTextColor={palette.textDim}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Text style={styles.hint}>{t('profile.apiKeyHint')}</Text>
            </ScrollView>

            {savingProvider ? (
              <View style={styles.busyBox}>
                <ActivityIndicator color={palette.text} />
              </View>
            ) : (
              <PrimaryButton
                icon="checkmark"
                label={t('common.save')}
                disabled={!formValid}
                onPress={() => {
                  void onSaveProvider();
                }}
              />
            )}
            <Pressable onPress={() => setEditorOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 84,
  },
  backText: { color: palette.text, fontSize: 16 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: palette.text,
    fontSize: 17,
    fontWeight: '800',
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  notConfigured: {
    color: palette.danger,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  scroll: { padding: 16, gap: 8, paddingBottom: 40 },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
  },
  sectionHint: { color: palette.textDim, fontSize: 12, lineHeight: 16, marginBottom: 8 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 6,
  },
  fieldLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginTop: 6 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  inputError: { borderColor: palette.danger },
  error: { color: palette.danger, fontSize: 12, fontWeight: '600' },
  hint: { color: palette.textDim, fontSize: 11 },
  busyBox: { height: 48, alignItems: 'center', justifyContent: 'center' },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  providerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  providerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  providerLabel: { color: palette.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  providerMeta: { color: palette.textDim, fontSize: 12, marginTop: 1 },
  defaultBadge: {
    backgroundColor: palette.accentSoft,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  defaultBadgeText: { color: palette.accent, fontSize: 9, fontWeight: '800' },
  iconBtn: { padding: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12 },
  addText: { color: palette.accent, fontSize: 14, fontWeight: '700' },
  emptyText: { color: palette.textDim, fontSize: 13, paddingVertical: 6 },
  taskRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: 6,
  },
  taskLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  taskChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emailText: { color: palette.text, fontSize: 14, marginBottom: 10 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  signOutText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    paddingBottom: 34,
    gap: 10,
    maxHeight: '88%',
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
  },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cancel: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { color: palette.textDim, fontSize: 13 },
});
