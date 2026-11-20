import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollabPresence } from '@/components/editor/CollabPresence';
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { accentGradient, palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';
import { useTutorial } from '@/store/tutorialStore';
import type { Project } from '@/types/project';

/**
 * 🧭 A szerkesztő fejléce: vissza, projektnév + mentés-állapot + remix-eredet,
 * AI-asszisztens, projekt-szoba, (tableten) bemutató/közreműködők/képarány,
 * ⋯ projekt-menü és az EGYETLEN Export belépő. A szerkesztő-képernyőből kiemelve.
 */
export function EditorHeader({
  project,
  dirty,
  saveFailed,
  collab,
  isCompact,
  goBack,
  onOpenLineage,
  openCollabChat,
  openCollabScreen,
  cycleAspect,
  openProjectMenu,
}: {
  project: Project | null;
  dirty: boolean;
  saveFailed: boolean;
  collab: { ownerId: string } | null;
  isCompact: boolean;
  goBack: () => void;
  onOpenLineage: () => void;
  openCollabChat: () => void;
  openCollabScreen: () => void;
  cycleAspect: () => void;
  openProjectMenu: () => void;
}) {
  const { t } = useTranslation();
  return (
  <View style={styles.header}>
    <Pressable onPress={goBack} hitSlop={8}>
      <Ionicons name="chevron-back" size={22} color={palette.text} />
    </Pressable>
    <View style={styles.headerTitleWrap}>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {project?.name ?? '…'}
      </Text>
      {/* 💾 mentés-állapot: hiba esetén figyelmeztetés, egyébként Mentve/Mentés… */}
      {saveFailed ? (
        <Text style={styles.saveFailed} numberOfLines={1}>
          ⚠️ {t('editorScreen.saveFailed')}
        </Text>
      ) : (
        <Text style={styles.saveState} numberOfLines={1}>
          {dirty ? `● ${t('editorScreen.saving')}` : `✓ ${t('editorScreen.saved')}`}
        </Text>
      )}
      {project?.remixOf ? (
        <Pressable
          onPress={onOpenLineage}
          hitSlop={4}
          accessibilityRole="button"
        >
          <Text style={styles.remixOf} numberOfLines={1}>
            🔀 {t('editorScreen.remixedFrom', { name: project.remixOf.name })}
          </Text>
        </Pressable>
      ) : null}
    </View>
    <View style={styles.headerActions}>
      {/* 👥 élő résztvevők (realtime presence) — csak ha más is bent van */}
      <CollabPresence />
      {/* ✨ AI-asszisztens — a fő megkülönböztető EGY koppintásra (D2; korábban „Több → AI") */}
      <Pressable
        onPress={() => {
          const st = useEditorStore.getState();
          st.setPanel(st.activePanel === 'assistant' ? null : 'assistant');
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('editorScreen.aiAssistant')}
      >
        <Ionicons name="sparkles" size={21} color={palette.accent} />
      </Pressable>
      {/* 👥 projekt-szoba (csapat-chat) — MINDIG elérhető (tulajként az első megnyitás
          hozza létre). Csoport-ikon: a buborék az AI-val volt összetéveszthető (D2). */}
      <Pressable
        onPress={openCollabChat}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('chat.projectConversation')}
      >
        <Ionicons
          name="people-circle-outline"
          size={23}
          color={collab ? palette.accent2 : palette.textDim}
        />
      </Pressable>
      {/* telefonon (compact) a ritka elemek — bemutató, közreműködők, képarány —
          a ⋯ projekt-menübe költöznek (MOBILE-UI §6.1): a fejléc egy sor marad */}
      {isCompact ? null : (
        <>
          {/* 🎓 interaktív bemutató indítása (felület-vezető) */}
          <Pressable
            onPress={() => useTutorial.getState().openMenu()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('tutorial.launch')}
          >
            <Ionicons name="help-circle-outline" size={22} color={palette.textDim} />
          </Pressable>
          <Pressable
            onPress={openCollabScreen}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('collab.title')}
          >
            <Ionicons
              name={collab ? 'people' : 'people-outline'}
              size={22}
              color={collab ? palette.accent : palette.textDim}
            />
          </Pressable>
          <Pressable onPress={cycleAspect} hitSlop={8} style={styles.aspectButton}>
            <Text style={styles.aspectText}>{project?.aspectRatio ?? ''}</Text>
          </Pressable>
        </>
      )}
      {/* ⋯ projekt-menü: Mentés most / Mentés másként (másolat) */}
      <Pressable
        onPress={openProjectMenu}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('editorScreen.projectMenuTitle')}
      >
        <Ionicons name="ellipsis-horizontal" size={22} color={palette.textDim} />
      </Pressable>
      {/* ▶️ a play-gomb a PREVIEW-ra került (PreviewSurface onOpenPlayer) — innen kivéve */}
      {/* Az EGYETLEN Export belépő (az alsó Toolbarból kivéve — nincs duplikáció).
          TutorialTarget: a felület-vezető export-lépése ide mutat. */}
      <TutorialTarget id="toolbar.export">
        <Pressable
          onPress={() => useEditorStore.getState().setPanel('export')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('editor.toolbar.export')}
        >
          <LinearGradient
            colors={[...accentGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.exportButton}
          >
            <Ionicons name="share-outline" size={14} color="#fff" />
            <Text style={styles.exportButtonText}>Export</Text>
          </LinearGradient>
        </Pressable>
      </TutorialTarget>
    </View>
  </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  remixOf: {
    color: palette.accent,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  saveFailed: {
    color: palette.danger,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  saveState: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  aspectButton: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: palette.surfaceHigh,
  },
  aspectText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
  },
});
