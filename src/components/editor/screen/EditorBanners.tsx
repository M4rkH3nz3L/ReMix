import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { CollabRole } from '@/lib/collab';
import { classifyMissingMedia, mediaRemoteMap } from '@/lib/mediaSync';
import { isProjectEmpty } from '@/lib/projectUtils';
import { isProjectTooLarge } from '@/lib/storage';
import { canCloudBackupMedia, projectMediaSafety } from '@/lib/storagePolicy';
import type { Tier } from '@/lib/tiers';
import type { MissingMedia } from '@/lib/videdFile';
import { usePaywall } from '@/store/paywallStore';
import type { Project } from '@/types/project';

/**
 * 🚩 A fejléc alatti sávok: hiányzó média, néző-szerep, túl nagy projekt,
 * FREE adatvesztés-figyelmeztetés és az üres projekt onboardingja.
 * A szerkesztő-képernyőből kiemelve.
 */
export function EditorBanners({
  id,
  project,
  missingMedia,
  relinking,
  collab,
  tier,
  sourceDocked,
  setMissingSheetOpen,
  openProjectMenu,
  setShowSource,
}: {
  id: string;
  project: Project | null;
  missingMedia: MissingMedia[];
  relinking: boolean;
  collab: { ownerId: string; role: CollabRole } | null;
  tier: Tier;
  sourceDocked: boolean;
  setMissingSheetOpen: (open: boolean) => void;
  openProjectMenu: () => void;
  setShowSource: (show: boolean) => void;
}) {
  const { t } = useTranslation();

  // 🩹 granuláris helyreállítás (CORE §2.8): a hiányzók közül hány ÁRVA (nincs
  // felhő-másolat → csak kézi relink segít) — a banner ezt külön jelzi, hogy a
  // felhasználó tudja, mire számítson a koppintás után.
  const orphanedCount =
    project && missingMedia.length > 0
      ? classifyMissingMedia(project, missingMedia, mediaRemoteMap(project)).orphaned.length
      : 0;
  const missingBanner =
    missingMedia.length > 0 ? (
      <Pressable style={styles.missingBanner} onPress={() => setMissingSheetOpen(true)}>
        <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
        <Text style={styles.missingBannerText}>
          {relinking
            ? t('editorScreen.relinking')
            : orphanedCount > 0
              ? t('editorScreen.missingMediaOrphaned', {
                  count: missingMedia.length,
                  orphaned: orphanedCount,
                })
              : t('editorScreen.missingMedia', { count: missingMedia.length })}
        </Text>
      </Pressable>
    ) : null;

  // 👁️ néző szerep → csak olvasható (a felhő-mentést az RLS úgyis blokkolja)
  const collabBanner =
    collab?.role === 'viewer' ? (
      <Pressable
        style={styles.collabBanner}
        onPress={() => router.push(`/collab/${id}?owner=${collab.ownerId}`)}
      >
        <Ionicons name="eye-outline" size={16} color={palette.textDim} />
        <Text style={styles.collabBannerText}>{t('collab.viewerBanner')}</Text>
      </Pressable>
    ) : null;

  // 📦 túl nagy projekt → a mentés lassulhat; a ⋯-menüből duplikálható/szétszedhető
  const sizeBanner =
    project && isProjectTooLarge(project) ? (
      <Pressable style={styles.sizeBanner} onPress={openProjectMenu}>
        <Ionicons name="archive-outline" size={16} color={palette.warning} />
        <Text style={styles.sizeBannerText}>{t('editorScreen.sizeWarning')}</Text>
      </Pressable>
    ) : null;

  // 🗄️ ADR-013: FREE usernél a média CSAK az eszközön van (nincs auto felhő-mentés) →
  // proaktív adatvesztés-figyelmeztetés + Pro-ajánlat. (Pro usernél a média R2-n van.)
  const storageAtRisk =
    !!project && !canCloudBackupMedia(tier) && projectMediaSafety(project).atRisk;
  const storageSafetyBanner = storageAtRisk ? (
    <Pressable
      style={styles.storageBanner}
      onPress={() => usePaywall.getState().open('mediaBackup')}
    >
      <Ionicons name="cloud-offline-outline" size={16} color={palette.warning} />
      <Text style={styles.storageBannerText}>{t('editorScreen.freeMediaLocalWarning')}</Text>
      <Ionicons name="chevron-forward" size={14} color={palette.textDim} />
    </Pressable>
  ) : null;

  // 🎬 üres projekt → a fekete vászon helyett a forrás-mappához vezető onboarding.
  // Tableten a forrás-dokk látszik (odamutatunk); telefonon a kártya megnyitja a sheetet.
  const emptyHint =
    project && isProjectEmpty(project) ? (
      <Pressable
        style={styles.emptyHint}
        onPress={sourceDocked ? undefined : () => setShowSource(true)}
        accessibilityRole={sourceDocked ? undefined : 'button'}
      >
        <Ionicons name="film-outline" size={22} color={palette.accent} />
        <View style={styles.emptyHintBody}>
          <Text style={styles.emptyHintTitle}>{t('editorScreen.emptyTitle')}</Text>
          <Text style={styles.emptyHintText}>
            {sourceDocked ? t('editorScreen.emptyHintDocked') : t('editorScreen.emptyHintSheet')}
          </Text>
        </View>
        {sourceDocked ? (
          <Ionicons name="arrow-back" size={18} color={palette.textDim} />
        ) : (
          <View style={styles.emptyHintCta}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.emptyHintCtaText}>{t('editorScreen.emptyCta')}</Text>
          </View>
        )}
      </Pressable>
    ) : null;

  return (
    <>
      {missingBanner}
      {collabBanner}
      {sizeBanner}
      {storageSafetyBanner}
      {emptyHint}
    </>
  );
}

const styles = StyleSheet.create({
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${palette.danger}1a`,
    borderWidth: 1,
    borderColor: `${palette.danger}55`,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  missingBannerText: {
    flex: 1,
    color: palette.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  collabBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  collabBannerText: {
    flex: 1,
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  sizeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${palette.warning}1a`,
    borderWidth: 1,
    borderColor: `${palette.warning}55`,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sizeBannerText: {
    flex: 1,
    color: palette.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  storageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${palette.warning}14`,
    borderWidth: 1,
    borderColor: `${palette.warning}44`,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  storageBannerText: {
    flex: 1,
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: `${palette.accent}55`,
    borderStyle: 'dashed',
    borderRadius: 14,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emptyHintBody: {
    flex: 1,
    gap: 2,
  },
  emptyHintTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  emptyHintText: {
    color: palette.textDim,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyHintCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyHintCtaText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
