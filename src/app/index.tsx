import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
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

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Chip, PrimaryButton } from '@/components/ui/controls';
import { aspectRatios, palette } from '@/constants/editor';
import { gridColumns } from '@/constants/layout';
import {
  createProjectFromTemplate,
  templateDescriptionKey,
  templateNameKey,
  templates,
} from '@/constants/templates';
import type { VideoTemplate } from '@/constants/templates';
import { useLayout } from '@/hooks/useLayout';
import { withProgress } from '@/store/progressStore';
import { createDemoProjects } from '@/lib/demoProjects';
import { makeId } from '@/lib/id';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, listProjects, loadProject, saveProject } from '@/lib/storage';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { formatTime } from '@/lib/time';
import { pickAndParseVided, relinkInteractive } from '@/lib/videdFile';
import type { AspectRatio, Project, ProjectMeta } from '@/types/project';

/** projekt-bélyegkép a lista-sorokhoz (az első videóklip kockája, cache-elve) */
const thumbCache = new Map<string, string | null>();
function ProjectThumb({ id }: { id: string }) {
  const [uri, setUri] = useState<string | null>(thumbCache.get(id) ?? null);
  useEffect(() => {
    if (thumbCache.has(id)) {
      return;
    }
    let alive = true;
    loadProject(id)
      .then(async (p) => {
        const clip = p?.tracks
          .find((t) => t.type === 'video')
          ?.clips.find((c) => c.kind === 'video');
        if (!clip || clip.kind !== 'video') {
          return null;
        }
        const [thumb] = await getFilmstrip(clip.uri, [snapThumbTime(clip.trimIn + 0.5)]);
        return thumb;
      })
      .then((thumb) => {
        thumbCache.set(id, thumb ?? null);
        if (alive) {
          setUri(thumb ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  if (!uri) {
    return (
      <View style={styles.cardIcon}>
        <Ionicons name="videocam" size={20} color={palette.accent} />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.cardThumb} contentFit="cover" />;
}

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const { t } = useTranslation();
  const L = useLayout();
  // a kártya kívánt szélességéből számolt rács — iPaden 3–4 oszlop is lehet,
  // a korábbi fix „640px → 2 oszlop" helyett (lásd @/constants/layout)
  const columns = gridColumns(L.width, 340, 4);

  const refresh = useCallback(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  useFocusEffect(refresh);

  const create = async () => {
    const project = createEmptyProject(name.trim() || t('home.newVideoDefault'), aspect);
    await saveProject(project);
    setCreating(false);
    setName('');
    router.push(`/editor/${project.id}`);
  };

  const createFromTemplate = (template: VideoTemplate) => {
    const project = createProjectFromTemplate(template);
    saveProject(project)
      .then(() => router.push(`/editor/${project.id}`))
      .catch(() => Alert.alert(t('common.error'), t('home.createFailed')));
  };

  const confirmDelete = (meta: ProjectMeta) => {
    Alert.alert(t('home.deleteTitle'), t('home.deleteMessage', { name: meta.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteProject(meta.id).then(refresh).catch(() => {});
        },
      },
    ]);
  };

  const duplicate = (meta: ProjectMeta) => {
    loadProject(meta.id)
      .then((p) => {
        if (!p) {
          return;
        }
        return saveProject({
          ...p,
          id: makeId('prj'),
          name: `${p.name}${t('home.copySuffix')}`,
          createdAt: new Date().toISOString(),
        });
      })
      .then(refresh)
      .catch(() => Alert.alert(t('common.error'), t('home.duplicateFailed')));
  };

  const startRename = (meta: ProjectMeta) => {
    setRenaming(meta);
    setRenameValue(meta.name);
  };

  const saveRename = () => {
    const meta = renaming;
    const nextName = renameValue.trim();
    setRenaming(null);
    if (!meta || !nextName || nextName === meta.name) {
      return;
    }
    loadProject(meta.id)
      .then((p) => (p ? saveProject({ ...p, name: nextName }) : undefined))
      .then(refresh)
      .catch(() => Alert.alert(t('common.error'), t('home.renameFailed')));
  };

  const projectMenu = (meta: ProjectMeta) => {
    Alert.alert(meta.name, undefined, [
      { text: t('common.rename'), onPress: () => startRename(meta) },
      { text: t('common.duplicate'), onPress: () => duplicate(meta) },
      { text: t('common.delete'), style: 'destructive', onPress: () => confirmDelete(meta) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const importVided = () => {
    pickAndParseVided()
      .then((result) => {
        if (!result) {
          return;
        }
        const finish = (p: Project) => {
          saveProject(p)
            .then(() => {
              refresh();
              router.push(`/editor/${p.id}`);
            })
            .catch(() => Alert.alert(t('common.import'), t('home.saveFailed')));
        };
        if (result.missing.length === 0) {
          if (result.relinked > 0) {
            Alert.alert(
              t('home.importDoneTitle'),
              t('home.importRelinked', { count: result.relinked })
            );
          }
          finish(result.project);
          return;
        }
        Alert.alert(
          t('home.missingMediaTitle'),
          t('home.missingMediaCount', { count: result.missing.length }) +
            (result.relinked > 0
              ? ' ' + t('home.missingMediaRelinkedNote', { count: result.relinked })
              : '') +
            '. ' +
            t('home.missingMediaAsk'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.later'), onPress: () => finish(result.project) },
            {
              text: t('home.relink'),
              onPress: () => {
                relinkInteractive(result.project, result.missing).then(finish);
              },
            },
          ]
        );
      })
      .catch((err: Error) => Alert.alert(t('common.import'), err.message));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Ionicons name="shuffle" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('home.appName')}</Text>
        </View>
        <Pressable
          onPress={() => setLangOpen(true)}
          hitSlop={8}
          style={styles.importButton}
          accessibilityRole="button"
          accessibilityLabel={t('language.title')}
        >
          <Ionicons name="language-outline" size={20} color={palette.textDim} />
          <Text style={styles.importLabel}>{t('language.title')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (demoBusy) {
              return;
            }
            setDemoBusy(true);
            withProgress(t('home.demoProgressLabel'), (report) => createDemoProjects(report))
              .then((n) => {
                refresh();
                Alert.alert(
                  t('home.demoTitle'),
                  n > 0 ? t('home.demoCreated', { count: n }) : t('home.demoExist')
                );
              })
              .catch((err: Error) => Alert.alert(t('home.demoTitle'), err.message))
              .finally(() => setDemoBusy(false));
          }}
          hitSlop={8}
          style={styles.importButton}
        >
          <Ionicons
            name={demoBusy ? 'hourglass-outline' : 'sparkles-outline'}
            size={20}
            color={palette.textDim}
          />
          <Text style={styles.importLabel}>{demoBusy ? t('home.demosLoading') : t('home.demos')}</Text>
        </Pressable>
        <Pressable onPress={importVided} hitSlop={8} style={styles.importButton}>
          <Ionicons name="download-outline" size={20} color={palette.textDim} />
          <Text style={styles.importLabel}>{t('common.import')}</Text>
        </Pressable>
      </View>

      <View style={styles.ctaWrap}>
        <PrimaryButton icon="add" label={t('home.newProject')} onPress={() => setCreating(true)} />
      </View>

      <FlatList
        data={projects}
        key={columns}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.listColumns : undefined}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { padding: L.spacing.lg }]}
        ListHeaderComponent={
          projects.length > 0 ? (
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>{t('home.recentProjects')}</Text>
              <Text style={styles.sectionHint}>
                {t('home.projectCount', { count: projects.length })}
              </Text>
            </View>
          ) : null
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
                    onPress={() => createFromTemplate(template)}
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
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, columns > 1 && styles.cardHalf]}
            onPress={() => router.push(`/editor/${item.id}`)}
            onLongPress={() => projectMenu(item)}
          >
            <ProjectThumb id={item.id} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.cardMeta}>
                {item.aspectRatio} · {formatTime(item.duration)} ·{' '}
                {t('home.clipCount', { count: item.clipCount })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.textDim} />
          </Pressable>
        )}
      />

      <View style={styles.tabBar}>
        {(
          [
            { icon: 'albums', label: t('home.tabProjects'), active: true, onPress: () => {} },
            {
              icon: 'grid-outline',
              label: t('home.tabTemplates'),
              onPress: () => setCreating(true),
            },
            {
              icon: 'sparkles-outline',
              label: t('home.tabAiTools'),
              onPress: () => Alert.alert(t('home.aiToolsTitle'), t('home.aiToolsMessage')),
            },
          ] as const
        ).map((tab) => (
          <Pressable key={tab.label} style={styles.tabItem} onPress={tab.onPress}>
            <Ionicons
              name={tab.icon}
              size={20}
              color={'active' in tab && tab.active ? palette.accent : palette.textDim}
            />
            <Text
              style={[
                styles.tabLabel,
                'active' in tab && tab.active ? styles.tabLabelActive : null,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={creating} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalGrabber} />
            <Text style={styles.modalTitle}>{t('home.newProject')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('home.projectNamePlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              autoFocus
            />
            <View style={styles.aspectRow}>
              {aspectRatios.map((option) => (
                <Chip
                  key={option.id}
                  label={t(option.label)}
                  active={aspect === option.id}
                  onPress={() => setAspect(option.id)}
                />
              ))}
            </View>
            <PrimaryButton
              icon="checkmark"
              label={t('common.create')}
              onPress={() => {
                create().catch(() => Alert.alert(t('common.error'), t('home.createFailed')));
              }}
            />
            <Pressable onPress={() => setCreating(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={renaming !== null} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalGrabber} />
            <Text style={styles.modalTitle}>{t('home.renameTitle')}</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={t('home.projectNamePlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              autoFocus
            />
            <PrimaryButton icon="checkmark" label={t('common.save')} onPress={saveRename} />
            <Pressable onPress={() => setRenaming(null)} style={styles.cancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <LanguageSwitcher visible={langOpen} onClose={() => setLangOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  importButton: {
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.surface,
  },
  importLabel: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '700',
  },
  feedButton: {
    alignItems: 'center',
    gap: 2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.accent,
    shadowColor: palette.accent,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  feedLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  title: {
    color: palette.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -1,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.accent,
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  ctaWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
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
  cardThumb: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  tabLabel: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: palette.accent,
  },
  subtitle: {
    color: palette.textDim,
    fontSize: 13,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  templatesBlock: {
    paddingTop: 10,
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
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
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
  footer: {
    padding: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: palette.border,
    padding: 20,
    paddingBottom: 34,
    gap: 14,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 2,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '800',
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  aspectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  cancelText: {
    color: palette.textDim,
    fontSize: 13,
  },
});
