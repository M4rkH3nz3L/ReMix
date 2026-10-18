import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AvatarBuilder } from '@/components/editor/AvatarBuilder';
import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { AI_CAPABILITIES } from '@/lib/aiPersona';
import type { AiProviderKind } from '@/lib/aiProviders';
import type { ProviderForm } from '@/hooks/useProfile';
import { PROVIDER_KINDS, PROVIDER_LABEL } from './aiProviderMeta';
import { profileStyles as styles } from './styles';

/** Egy AI-provider típus metaadata (kulcs-kötelezettség + minta-értékek a placeholderekhez). */
interface KindMeta {
  needsKey: boolean;
  sampleModel: string;
  defaultBaseUrl: string;
}

/**
 * 🤖 AI-provider szerkesztő modal: cím/típus/modell/base-URL/API-kulcs + a persona
 * (képességek + karakter-építő + történet + generátor). Prezentációs — az űrlap-állapot
 * (`form`/`setForm`) és a handlerek propból jönnek (saját fetch/validáció nincs).
 */
export function ProviderEditorModal({
  visible,
  form,
  setForm,
  kindMeta,
  saving,
  valid,
  onSave,
  onGeneratePersona,
  onClose,
}: {
  visible: boolean;
  form: ProviderForm;
  setForm: React.Dispatch<React.SetStateAction<ProviderForm>>;
  kindMeta: KindMeta;
  saving: boolean;
  valid: boolean;
  onSave: () => void;
  onGeneratePersona: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide">
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
                  onPress={() => setForm((f) => ({ ...f, provider: kind as AiProviderKind }))}
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

            {/* 👤 Karakter (persona) — személyesebb hangulat */}
            <Text style={styles.fieldLabel}>{t('profile.personaSection')}</Text>
            <Text style={styles.hint}>{t('profile.personaHint')}</Text>

            <Text style={styles.fieldLabel}>{t('profile.personaPurpose')}</Text>
            <View style={styles.chipRow}>
              {AI_CAPABILITIES.map((c) => (
                <Chip
                  key={c.id}
                  label={`${c.emoji} ${t('aiPersona.cap_' + c.id)}`}
                  active={form.capabilities.includes(c.id)}
                  onPress={() =>
                    setForm((f) => ({
                      ...f,
                      capabilities: f.capabilities.includes(c.id)
                        ? f.capabilities.filter((x) => x !== c.id)
                        : [...f.capabilities, c.id],
                    }))
                  }
                />
              ))}
            </View>

            {/* 🧑‍🎨 karakter-építő (a user rakja össze) */}
            <AvatarBuilder
              value={form.avatar}
              onChange={(a) => setForm((f) => ({ ...f, avatar: a }))}
            />

            <TextInput
              value={form.personaStory}
              onChangeText={(v) => setForm((f) => ({ ...f, personaStory: v }))}
              placeholder={t('profile.personaStoryPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={[styles.input, styles.storyInput]}
              multiline
            />
            <Pressable onPress={onGeneratePersona} style={styles.addRow}>
              <Ionicons name="sparkles-outline" size={20} color={palette.accent} />
              <Text style={styles.addText}>{t('profile.personaGenerate')}</Text>
            </Pressable>
          </ScrollView>

          {saving ? (
            <View style={styles.busyBox}>
              <ActivityIndicator color={palette.text} />
            </View>
          ) : (
            <PrimaryButton
              icon="checkmark"
              label={t('common.save')}
              disabled={!valid}
              onPress={onSave}
            />
          )}
          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
