import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import {
  templateDescriptionKey,
  templateNameKey,
  templates,
} from '@/constants/templates';
import { BottomNav, BOTTOM_NAV_HEIGHT } from '@/components/BottomNav';
import { UsageBanner } from '@/components/UsageBanner';
import { PrimaryButton } from '@/components/ui/controls';
import { CreateProjectModal } from '@/components/studio/CreateProjectModal';
import { ProjectThumb } from '@/components/studio/ProjectThumb';
import { RenameModal } from '@/components/studio/RenameModal';
import { StudioHeader } from '@/components/studio/StudioHeader';
import { StudioTabBar } from '@/components/studio/StudioTabBar';
import { useStudio } from '@/hooks/useStudio';
import { studioRoute } from '@/lib/projectUtils';
import { formatBytes as formatStorageBytes } from '@/lib/storageQuota';
import { formatTime } from '@/lib/time';
import type { ProjectMeta } from '@/types/project';

/**
 * 🎬 Stúdió / projekt-lista képernyő (expo-router route) — VÉKONY KOMPOZÍCIÓ.
 * A nem-prezentációs logika a `useStudio()` hookban él; a nagy JSX-szekciók
 * al-komponensekben (`@/components/studio/*`). Itt már csak az összerakás + a
 * projekt-lista (FlatList) marad, ami szorosan a rács-oszlopokra/stílusokra ül.
 */
export default function ProjectsScreen() {
  const s = useStudio();
  const { t, L, columns, listRef, projects, storageMap, shared } = s;
  // 📐 a rács-cella pontos szélessége (lista − padding − oszlopközök) / oszlopszám
  const [listW, setListW] = useState(0);
  const cellMax = listW > 0 ? (listW - 2 * L.spacing.lg - 10 * (columns - 1)) / columns : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <StudioHeader onImport={s.importVided} />

      <UsageBanner />

      <View style={styles.ctaWrap}>
        <PrimaryButton icon="add" label={t('home.newProject')} onPress={() => s.setCreating(true)} />
        {/* 🗂️ Tárhelyem: eszköz + ReMix Storage (R2) egy helyen */}
        <Pressable
          onPress={() => router.push('/storage' as Href)}
          style={({ pressed }) => [styles.storageBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
        >
          <Ionicons name="folder-open-outline" size={16} color={palette.text} />
          <Text style={styles.storageBtnText}>{t('home.myStorage')}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={projects}
        key={columns}
        onLayout={(e) => setListW(e.nativeEvent.layout.width)}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.listColumns : undefined}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { padding: L.spacing.lg, paddingBottom: BOTTOM_NAV_HEIGHT + 32 }]}
        ListHeaderComponent={
          <>
            {shared.length > 0 ? (
              <View style={styles.sharedBlock}>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>{t('collab.sharedWithMe')}</Text>
                  <Text style={styles.sectionHint}>
                    {t('home.projectCount', { count: shared.length })}
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.templatesRow}
                >
                  {shared.map((sp) => (
                    <Pressable
                      key={`${sp.ownerId}:${sp.projectId}`}
                      style={styles.sharedCard}
                      onPress={() => router.push(`/collab/${sp.projectId}?owner=${sp.ownerId}`)}
                    >
                      <Ionicons name="people" size={18} color={palette.accent} />
                      <Text style={styles.sharedName} numberOfLines={2}>
                        {sp.projectName ?? sp.projectId}
                      </Text>
                      <Text style={styles.sharedRole}>{t(`collab.role.${sp.role}`)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            {projects.length > 0 ? (
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>{t('home.recentProjects')}</Text>
                <Text style={styles.sectionHint}>
                  {t('home.projectCount', { count: projects.length })}
                </Text>
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="film-outline" size={44} color={palette.border} />
            <Text style={styles.emptyText}>
              {t('home.emptyTitle')}
              {'\n'}
              {t('home.emptyHint')}
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.templatesBlock}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>{t('home.templates')}</Text>
              <Text style={styles.sectionHint}>{t('common.all')}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.templatesRow}
            >
              {/* a felkapottak előre — később backend trend-adat rendezi */}
              {[...templates]
                .sort((a, b) => Number(b.trending ?? false) - Number(a.trending ?? false))
                .map((template) => (
                  <Pressable
                    key={template.id}
                    style={[styles.templateCard, { width: L.isCompact ? 132 : 168 }]}
                    onPress={() => s.createFromTemplate(template)}
                  >
                    {template.trending ? (
                      <View style={styles.trendBadge}>
                        <Text style={styles.trendBadgeText}>{t('home.trend')}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.templateEmoji}>{template.emoji}</Text>
                    <Text style={styles.templateName} numberOfLines={1}>
                      {t(templateNameKey(template.id))}
                    </Text>
                    <Text style={styles.templateDesc} numberOfLines={2}>
                      {t(templateDescriptionKey(template.id))}
                    </Text>
                    <Text style={styles.templateMeta}>{template.aspectRatio}</Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        }
        renderItem={({ item }: { item: ProjectMeta }) => {
          const itemKind = item.kind ?? 'video';
          return (
            <Pressable
              // a rács utolsó, magában álló kártyája se nyúljon a teljes szélességre (élő teszt L3)
              style={[styles.card, columns > 1 && styles.cardHalf, columns > 1 && cellMax ? { maxWidth: cellMax } : null]}
              onPress={() => router.push(studioRoute(item.kind, item.id) as Href)}
              onLongPress={() => s.projectMenu(item)}
            >
              <ProjectThumb id={item.id} kind={itemKind} version={item.updatedAt} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.cardMeta}>
                  {t(`studio.kind.${itemKind}`)}
                  {/* a 3D-modellnek nincs képaránya/hossza — csak a fajta (+ tárhely) */}
                  {itemKind !== 'audio' && itemKind !== 'model3d' ? ` · ${item.aspectRatio}` : ''}
                  {itemKind !== 'image' && itemKind !== 'model3d' ? ` · ${formatTime(item.duration)}` : ''}
                  {itemKind === 'video'
                    ? ` · ${t('home.clipCount', { count: item.clipCount })}`
                    : ''}
                  {storageMap[item.id] ? ` · ☁️ ${formatStorageBytes(storageMap[item.id])}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textDim} />
            </Pressable>
          );
        }}
      />

      <StudioTabBar
        onScrollTop={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
        onScrollEnd={() => listRef.current?.scrollToEnd({ animated: true })}
        onAiTools={s.openAiTools}
      />

      <CreateProjectModal
        visible={s.creating}
        L={L}
        name={s.name}
        setName={s.setName}
        seoDescription={s.seoDescription}
        setSeoDescription={s.setSeoDescription}
        seoHashtags={s.seoHashtags}
        setSeoHashtags={s.setSeoHashtags}
        seoKeywords={s.seoKeywords}
        setSeoKeywords={s.setSeoKeywords}
        kind={s.kind}
        setKind={s.setKind}
        aspect={s.aspect}
        setAspect={s.setAspect}
        imgW={s.imgW}
        setImgW={s.setImgW}
        imgH={s.imgH}
        setImgH={s.setImgH}
        imgFormat={s.imgFormat}
        setImgFormat={s.setImgFormat}
        bg={s.bg}
        setBg={s.setBg}
        audioTarget={s.audioTarget}
        setAudioTarget={s.setAudioTarget}
        model3dFormat={s.model3dFormat}
        setModel3dFormat={s.setModel3dFormat}
        sources={s.sources}
        addSource={s.addSource}
        removeSource={s.removeSource}
        seoReady={s.seoReady}
        missingFields={s.missingFields}
        onCreate={() => {
          s.create().catch(() => {
            /* a create() belül kezeli a hibát; a .catch csak a lebegő-promise-t zárja */
          });
        }}
        onCancel={s.cancelCreate}
      />

      <RenameModal
        visible={s.renaming !== null}
        value={s.renameValue}
        onChangeValue={s.setRenameValue}
        onSave={s.saveRename}
        onCancel={() => s.setRenaming(null)}
      />
      <BottomNav active="studio" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  ctaWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  storageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  storageBtnText: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionHint: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  templatesBlock: {
    paddingTop: 10,
  },
  sharedBlock: {
    paddingBottom: 6,
    marginBottom: 6,
  },
  sharedCard: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    gap: 6,
    width: 150,
  },
  sharedName: { color: palette.text, fontSize: 14, fontWeight: '700' },
  sharedRole: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  templatesRow: {
    paddingHorizontal: 16,
    gap: 10,
  },
  templateCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  templateEmoji: {
    fontSize: 22,
  },
  templateName: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  templateDesc: {
    color: palette.textDim,
    fontSize: 10,
    lineHeight: 14,
  },
  templateMeta: {
    color: palette.accent,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  trendBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#ff5c7226',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  trendBadgeText: {
    color: palette.danger,
    fontSize: 8,
    fontWeight: '800',
  },
  list: {
    gap: 10,
    flexGrow: 1,
  },
  listColumns: {
    gap: 10,
  },
  cardHalf: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    color: palette.textDim,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardName: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  cardMeta: {
    color: palette.textDim,
    fontSize: 12,
    marginTop: 2,
  },
});
