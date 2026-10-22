import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { setLanguage } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';
import { CollapsibleCard } from '@/components/ui/CollapsibleCard';
import { CoverPhotoEditor } from '@/components/CoverPhotoEditor';
import { SocialLinksEditor } from '@/components/profile/SocialLinksEditor';
import { ShowcaseEditor } from '@/components/profile/ShowcaseEditor';
import { StorageCard } from '@/components/profile/StorageCard';
import { WalletCard } from '@/components/profile/WalletCard';
import { IdentityCard } from '@/components/profile/IdentityCard';
import { PersonalCard } from '@/components/profile/PersonalCard';
import { CreatorCard } from '@/components/profile/CreatorCard';
import { SubscriptionCard } from '@/components/profile/SubscriptionCard';
import { AiModelsCard } from '@/components/profile/AiModelsCard';
import { AiTasksCard } from '@/components/profile/AiTasksCard';
import { FactoryModelsCard } from '@/components/profile/FactoryModelsCard';
import { PerformanceCard } from '@/components/profile/PerformanceCard';
import { AccountCard } from '@/components/profile/AccountCard';
import { LegalCard } from '@/components/profile/LegalCard';
import { ProviderEditorModal } from '@/components/profile/ProviderEditorModal';
import { profileStyles as styles } from '@/components/profile/styles';
import { useProfile } from '@/hooks/useProfile';

/**
 * 👤 Profil — a bejelentkezett felhasználó adatai és beállításai (VÉKONY KOMPOZÍCIÓ).
 *  - Személyes/creator adatok (profiles tábla), social/showcase, nyelv
 *  - Pro-előfizetés, koin-pénztárca, tárhely, teljesítmény/gyorsítótár
 *  - AI-modellek (user_ai_providers): saját endpoint + kulcs (BYOK) + feladat-mátrix
 *  - Fiók / jogi / kijelentkezés
 *
 * A NEM-prezentációs logika a `useProfile()` hookban, a szekciók a
 * `src/components/profile/` al-komponensekben (props-ból rendelnek, saját fetch nélkül).
 */
export default function ProfileScreen() {
  const p = useProfile();
  const { t, i18n } = p;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('profile.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {p.loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : !p.configured ? (
        <View style={styles.loadingBox}>
          <Text style={styles.notConfigured}>{t('auth.notConfigured')}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 🛡️ Admin-panel (RBAC) — csak jog-birtokosnak */}
          {p.canAdmin ? (
            <Pressable
              onPress={() => router.push('/admin')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 13,
                marginBottom: 10,
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color={palette.accent} />
              <Text style={{ flex: 1, color: palette.text, fontSize: 15, fontWeight: '700' }}>
                {t('admin.title')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={palette.textDim} />
            </Pressable>
          ) : null}

          {/* ═══ PROFIL-SZERKESZTŐ: összecsukható szekciók ═══ */}

          {/* — 👤 Identitás: kép/borító + username + név + bio — */}
          <IdentityCard
            profile={p.profile}
            setField={p.setField}
            usernameError={p.usernameError}
            nameError={p.nameError}
            imgBusy={p.imgBusy}
            onPickImage={(kind) => void p.onPickProfileImage(kind)}
            savingProfile={p.savingProfile}
            profileValid={p.profileValid}
            onSaveProfile={p.onSaveProfile}
          />

          {/* — 🔒 Személyes adatok (alapból privát mezők) — */}
          <PersonalCard
            profile={p.profile}
            setField={p.setField}
            setArr={p.setArr}
            phoneError={p.phoneError}
            birthdayError={p.birthdayError}
            detectTimezone={p.detectTimezone}
            savingProfile={p.savingProfile}
            profileValid={p.profileValid}
            onSaveProfile={p.onSaveProfile}
          />

          {/* — 🎨 Creator: mutasd be magad — */}
          <CreatorCard
            profile={p.profile}
            setField={p.setField}
            setArr={p.setArr}
            savingProfile={p.savingProfile}
            profileValid={p.profileValid}
            onSaveProfile={p.onSaveProfile}
          />

          {/* — 🔗 Social linkek — */}
          {p.userId ? (
            <CollapsibleCard
              icon="link-outline"
              title={t('profile.socialSection')}
              subtitle={t('profile.socialHint')}
            >
              <SocialLinksEditor userId={p.userId} />
            </CollapsibleCard>
          ) : null}

          {/* — 🖼️ Showcase (portfólió) — */}
          {p.userId ? (
            <CollapsibleCard
              icon="albums-outline"
              title={t('profile.showcaseSection')}
              subtitle={t('profile.showcaseHint')}
            >
              <ShowcaseEditor userId={p.userId} />
            </CollapsibleCard>
          ) : null}

          {/* — Nyelv — */}
          <Text style={styles.sectionTitle}>{t('profile.languageSection')}</Text>
          <View style={styles.card}>
            <View style={styles.chipRow}>
              {SUPPORTED_LANGUAGES.map((l) => (
                <Chip
                  key={l.code}
                  label={`${l.flag} ${l.native}`}
                  active={i18n.language === l.code}
                  onPress={() => {
                    void setLanguage(l.code);
                  }}
                />
              ))}
            </View>
          </View>

          {/* — Pro előfizetés — */}
          <SubscriptionCard
            isPro={p.isPro}
            sub={p.sub}
            proMeta={p.proMeta}
            onSubscribe={p.onSubscribe}
            onRestore={p.onRestore}
            devBusy={p.devBusy}
            onDevActivate={p.onDevActivate}
            onDevDeactivate={p.onDevDeactivate}
          />

          {/* — Koin-pénztárca (vétel / Pro / küldés / kiváltás) — */}
          <WalletCard />

          {/* — Tárhely + külső tárhelyek — */}
          <StorageCard />

          {/* — Gyári AI-modellek (local-ai 5.1): katalógus cél-kötéssel — */}
          <FactoryModelsCard />

          {/* — AI-modellek — */}
          <AiModelsCard
            providers={p.providers}
            onSetDefault={p.onSetDefault}
            onEdit={p.openEdit}
            onDelete={p.onDeleteProvider}
            onAdd={p.openNew}
          />

          {/* — AI-modellek feladatonként (mátrix) — */}
          <AiTasksCard providers={p.providers} taskAssign={p.taskAssign} onPickTask={p.pickTask} />

          {/* — Teljesítmény / gyorsítótár — */}
          <PerformanceCard
            proxyEnabled={p.proxyEnabled}
            proxyQuality={p.proxyQuality}
            setProxyEnabled={p.setProxyEnabled}
            setProxyQuality={p.setProxyQuality}
            cacheInfo={p.cacheInfo}
            onClearCache={p.onClearCache}
          />

          {/* — Fiók — */}
          <AccountCard
            email={p.email}
            onSignOutOthers={p.onSignOutOthers}
            onSignOut={p.onSignOut}
            onDeleteAccount={p.onDeleteAccount}
          />

          {/* — 📜 Jogi / Adatvédelem (GDPR) — */}
          <LegalCard onExportData={p.onExportData} />
        </ScrollView>
      )}

      {/* — provider szerkesztő modal — */}
      <ProviderEditorModal
        visible={p.editorOpen}
        form={p.form}
        setForm={p.setForm}
        kindMeta={p.kindMeta}
        saving={p.savingProvider}
        valid={p.formValid}
        onSave={p.onSaveProvider}
        onGeneratePersona={p.generateFormPersona}
        onClose={() => p.setEditorOpen(false)}
      />

      {/* 🖼️ borító-igazító: húzd a képet a kívánt kivágáshoz, majd Kész */}
      <CoverPhotoEditor
        uri={p.coverDraftUri}
        busy={p.imgBusy}
        onCancel={() => p.setCoverDraftUri(null)}
        onConfirm={p.commitCover}
      />
    </SafeAreaView>
  );
}
