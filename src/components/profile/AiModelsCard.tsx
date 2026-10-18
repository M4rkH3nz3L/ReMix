import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { AvatarSvg } from '@/components/AvatarSvg';
import { palette } from '@/constants/editor';
import { AI_CAPABILITIES } from '@/lib/aiPersona';
import type { AiProvider } from '@/lib/aiProviders';
import { PROVIDER_LABEL } from './aiProviderMeta';
import { profileStyles as styles } from './styles';

/**
 * 🤖 AI-modellek (user_ai_providers) lista: alapértelmezett-választás (rádió), szerkesztés,
 * törlés, és „új modell". Prezentációs — a CRUD-handlerek propból jönnek (saját fetch nincs).
 */
export function AiModelsCard({
  providers,
  onSetDefault,
  onEdit,
  onDelete,
  onAdd,
}: {
  providers: AiProvider[];
  onSetDefault: (p: AiProvider) => void;
  onEdit: (p: AiProvider) => void;
  onDelete: (p: AiProvider) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
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
                <AvatarSvg config={p.avatar} size={34} />
                <View style={{ flex: 1 }}>
                  <View style={styles.providerTitleRow}>
                    <Text style={styles.providerLabel} numberOfLines={1}>
                      {p.label}
                    </Text>
                    {p.isDefault ? (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>{t('profile.defaultBadge')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.providerMeta} numberOfLines={1}>
                    {PROVIDER_LABEL[p.provider]} · {p.model || '—'}
                    {p.apiKey ? ' · 🔑' : ''}
                    {p.capabilities && p.capabilities.length > 0
                      ? ' · ' +
                        p.capabilities
                          .map((c) => AI_CAPABILITIES.find((x) => x.id === c)?.emoji ?? '')
                          .join('')
                      : ''}
                  </Text>
                </View>
              </Pressable>
              <Pressable onPress={() => onEdit(p)} hitSlop={8} style={styles.iconBtn}>
                <Ionicons name="create-outline" size={20} color={palette.textDim} />
              </Pressable>
              <Pressable onPress={() => onDelete(p)} hitSlop={8} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={20} color={palette.danger} />
              </Pressable>
            </View>
          ))
        )}
        <Pressable onPress={onAdd} style={styles.addRow}>
          <Ionicons name="add-circle-outline" size={20} color={palette.accent} />
          <Text style={styles.addText}>{t('profile.addModel')}</Text>
        </Pressable>
      </View>
    </>
  );
}
