import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  WORKFLOW_STAGES,
  currentStage,
  stageStatus,
  type WorkflowStageId,
} from '@/lib/workflow';
import type { PanelId } from '@/store/editorStore';
import { useEditorStore } from '@/store/editorStore';
import type { Asset } from '@/types/project';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** gyors „bin"/címke-presetek az Organize-hoz (rövid, vágás-orientált) */
const TAG_PRESETS = ['keep', 'maybe', 'aroll', 'broll', 'hook'] as const;

/**
 * 🎬 Pro Workflow panel: a profi vágás 10 szakasza egy vezetett lépcsőként. Nem
 * új funkció — a MEGLÉVŐ eszközökhöz visz el szakaszonként (setPanel), a
 * projekt-állapotból pipálja, mi van kész, és javasolja a következő lépést. Az
 * Organize szakasznak saját UI-ja (asset-rendszerezés: kedvenc / értékelés /
 * címkék), a többi a meglévő panelekre routol.
 */
export function WorkflowPanel() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const setPanel = useEditorStore((s) => s.setPanel);
  const [expanded, setExpanded] = useState<WorkflowStageId | null>(null);

  if (!project) {
    return null;
  }

  const status = stageStatus(project);
  const current = currentStage(status);
  const openId = expanded ?? current;
  const doneCount = Object.values(status).filter(Boolean).length;

  const assets = project.assets ?? [];

  const patchAsset = (assetId: string, patch: Partial<Asset>) => {
    useEditorStore.getState().dispatch({ type: 'UPDATE_ASSET', assetId, patch }, 'user');
  };
  const toggleFavorite = (a: Asset) => patchAsset(a.id, { favorite: !a.favorite });
  const setRating = (a: Asset, n: number) => patchAsset(a.id, { rating: a.rating === n ? 0 : n });
  const toggleTag = (a: Asset, tag: string) => {
    const tags = a.tags ?? [];
    patchAsset(a.id, { tags: tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag] });
  };

  const assetName = (a: Asset) => a.name ?? a.uri.split('/').pop() ?? a.kind;
  const assetMeta = (a: Asset) => {
    const parts: string[] = [t(`panels.workflow.kind_${a.kind}`)];
    if (a.width && a.height) {
      parts.push(`${a.width}×${a.height}`);
    }
    if (a.duration) {
      parts.push(`${a.duration.toFixed(1)}s`);
    }
    return parts.join(' · ');
  };

  return (
    <View>
      <PanelSection title={t('panels.workflow.title')}>
        <Text style={styles.progress}>
          {t('panels.workflow.progress', { done: doneCount, total: WORKFLOW_STAGES.length })}
        </Text>
        <Text style={styles.note}>{t('panels.workflow.intro')}</Text>
      </PanelSection>

      {WORKFLOW_STAGES.map((stage, i) => {
        const done = status[stage.id];
        const isCurrent = stage.id === current;
        const isOpen = stage.id === openId;
        return (
          <View key={stage.id} style={styles.stageWrap}>
            <Pressable
              style={[styles.stageHead, isOpen ? styles.stageHeadOpen : null]}
              onPress={() => setExpanded(stage.id)}
            >
              {/* állapot-korong: pipa (kész) / aktuális / hátralévő */}
              <View
                style={[
                  styles.badge,
                  done ? styles.badgeDone : isCurrent ? styles.badgeCurrent : styles.badgeTodo,
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={13} color={palette.bg} />
                ) : (
                  <Text style={styles.badgeNum}>{i + 1}</Text>
                )}
              </View>
              <Ionicons name={stage.icon as IoniconName} size={16} color={isOpen ? palette.accent : palette.textDim} />
              <Text style={[styles.stageLabel, isOpen ? styles.stageLabelOpen : null]} numberOfLines={1}>
                {t(`panels.workflow.stage_${stage.id}`)}
              </Text>
              {isCurrent ? <Text style={styles.currentTag}>{t('panels.workflow.currentTag')}</Text> : null}
            </Pressable>

            {isOpen ? (
              <View style={styles.stageBody}>
                <Text style={styles.note}>{t(`panels.workflow.desc_${stage.id}`)}</Text>

                {/* Organize: saját asset-rendszerező UI */}
                {stage.id === 'organize' ? (
                  assets.length === 0 ? (
                    <Text style={styles.note}>{t('panels.workflow.organizeEmpty')}</Text>
                  ) : (
                    assets.map((a) => (
                      <View key={a.id} style={styles.assetRow}>
                        <View style={styles.assetInfo}>
                          <View style={styles.assetNameRow}>
                            <Pressable onPress={() => toggleFavorite(a)} hitSlop={8}>
                              <Ionicons
                                name={a.favorite ? 'heart' : 'heart-outline'}
                                size={16}
                                color={a.favorite ? palette.danger : palette.textDim}
                              />
                            </Pressable>
                            <Text style={styles.assetName} numberOfLines={1}>
                              {assetName(a)}
                            </Text>
                          </View>
                          <Text style={styles.assetMeta}>{assetMeta(a)}</Text>
                          <View style={styles.stars}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Pressable key={n} onPress={() => setRating(a, n)} hitSlop={4}>
                                <Ionicons
                                  name={(a.rating ?? 0) >= n ? 'star' : 'star-outline'}
                                  size={15}
                                  color={(a.rating ?? 0) >= n ? palette.accent : palette.textDim}
                                />
                              </Pressable>
                            ))}
                          </View>
                          <View style={styles.tagRow}>
                            {TAG_PRESETS.map((tag) => (
                              <Chip
                                key={tag}
                                label={t(`panels.workflow.tag_${tag}`)}
                                active={(a.tags ?? []).includes(tag)}
                                onPress={() => toggleTag(a, tag)}
                              />
                            ))}
                          </View>
                        </View>
                      </View>
                    ))
                  )
                ) : null}

                {/* a szakasz eszközei: a meglévő panelek megnyitása */}
                {stage.panels.length > 0 ? (
                  <View style={styles.toolRow}>
                    {stage.panels.map((panel) => (
                      <Chip
                        key={panel}
                        label={t(`panels.workflow.tool_${panel}`)}
                        active={false}
                        onPress={() => setPanel(panel as PanelId)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  stageWrap: {
    marginTop: 6,
  },
  stageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  stageHeadOpen: {
    backgroundColor: palette.surfaceHigh,
  },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: {
    backgroundColor: palette.accent,
  },
  badgeCurrent: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: palette.accent,
  },
  badgeTodo: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.border,
  },
  badgeNum: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '800',
  },
  stageLabel: {
    flex: 1,
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  stageLabelOpen: {
    fontWeight: '800',
  },
  currentTag: {
    color: palette.accent,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stageBody: {
    paddingLeft: 40,
    paddingRight: 8,
    paddingBottom: 8,
    gap: 8,
  },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assetRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    paddingTop: 8,
  },
  assetInfo: {
    gap: 5,
  },
  assetNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assetName: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  assetMeta: {
    color: palette.textDim,
    fontSize: 11,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
