import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import {
  duplicateLayer,
  layerIcon,
  layerLabel,
  removeLayer,
  moveLayerTo,
  toggleLayerHidden,
  toggleLayerLocked,
  ungroup,
  updateGroup,
} from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { mergeDownTargets } from '@/lib/imageCanvasOps';
import type { ImageDoc, ImageGroup, ImageLayer } from '@/types/project';

/** egy réteg-sor magassága + a köztük lévő rés (a húzás ennyi pixelenként lép egyet) */
const LAYER_ROW_STEP = 56;

/**
 * 🎨 Réteg-panel (a munkaterület jobb oldala) — a réteg-fa listája (sorrend, láthatóság,
 * zárolás) és a kijelölt réteg műveletei. A réteg beállításai az alsó Stílus-lapon vannak.
 * Minden módosítás a command-buson (undo).
 */
export function LayerPanel({
  doc,
  selectedId,
  onSelect,
  onAdd,
  onMergeDown,
  onRasterize,
  onFlatten,
  commit,
  onClose,
  onOpenStyle,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: ImageLayer['kind']) => void;
  onMergeDown: (id: string) => void;
  onRasterize: (id: string) => void;
  onFlatten: () => void;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
  /** a kijelölt réteg beállításai (alsó lap) */
  onOpenStyle: () => void;
}) {
  const { t } = useTranslation();
  const layer = doc.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <StudioSheet
      title={t('studio.image.layersTitle')}
      icon="layers"
      onClose={onClose}
      footer={
        <View style={styles.addRow}>
          <AddChip icon="text" label={t('studio.imageTools.text')} onPress={() => onAdd('text')} />
          <AddChip icon="shapes" label={t('studio.imageTools.shape')} onPress={() => onAdd('shape')} />
          <AddChip icon="image" label={t('studio.imageTools.photo')} onPress={() => onAdd('photo')} />
          <AddChip icon="color-fill" label={t('studio.imageTools.fill')} onPress={() => onAdd('fill')} />
          <AddChip icon="options-outline" label={t('studio.imageTools.adjust', { defaultValue: 'Korrekció' })} onPress={() => onAdd('adjust')} />
        </View>
      }
    >
      {/* réteg-lista (fölül a legfelső réteg) — 🗂️ csoportokba bucketelve */}
      <View style={{ gap: 6 }}>
        {(() => {
          const groupsById = new Map((doc.groups ?? []).map((g) => [g.id, g]));
          const seen = new Set<string>();
          const rows: ReactNode[] = [];
          for (const l of [...doc.layers].reverse()) {
            const g = l.groupId ? groupsById.get(l.groupId) : undefined;
            if (g && !seen.has(g.id)) {
              seen.add(g.id);
              rows.push(
                <GroupHeader
                  key={`g-${g.id}`}
                  doc={doc}
                  group={g}
                  commit={commit}
                  onSelect={onSelect}
                  t={t}
                />
              );
            }
            if (g?.collapsed) {
              continue; // összecsukva: a tag-sorok nem jelennek meg
            }
            rows.push(
              <LayerRow
                key={l.id}
                doc={doc}
                layer={l}
                indented={!!g}
                selected={l.id === selectedId}
                onSelect={onSelect}
                commit={commit}
                t={t}
              />
            );
          }
          return rows;
        })()}
      </View>

      {/* a kijelölt réteg műveletei; a beállításai alul nyílnak (Stílus) */}
      {layer ? (
        <View style={styles.inspector}>
          <Text style={styles.inspectorTitle} numberOfLines={1}>{layerLabel(layer)}</Text>
          <View style={styles.opsRow}>
            <OpChip icon="options-outline" label={t('studio.imageTools.style')} onPress={onOpenStyle} />
            <OpChip
              icon="copy-outline"
              label={t('studio.imageTools.duplicate')}
              onPress={() => commit(duplicateLayer(doc, layer.id, () => makeId('lyr')), t('studio.image.undoDuplicate'))}
            />
            <OpChip
              icon="trash-outline"
              label={t('studio.imageTools.delete')}
              disabled={!!layer.locked}
              onPress={() => {
                commit(removeLayer(doc, layer.id), t('studio.image.undoDelete'));
                onSelect(null);
              }}
            />
            <OpChip icon="git-merge-outline" label={t('studio.image.mergeDown')} disabled={!mergeDownTargets(doc, layer.id)} onPress={() => onMergeDown(layer.id)} />
            {layer.kind === 'text' || layer.kind === 'shape' ? (
              <OpChip icon="image-outline" label={t('studio.image.rasterize')} disabled={!!layer.locked} onPress={() => onRasterize(layer.id)} />
            ) : null}
            <OpChip icon="albums-outline" label={t('studio.image.flatten')} disabled={doc.layers.length < 2} onPress={onFlatten} />
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>{t('studio.image.selectHint')}</Text>
      )}
    </StudioSheet>
  );
}

function OpChip({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.addChip, disabled ? styles.chipDisabled : null]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={15} color={palette.accent} />
      <Text style={styles.addChipText}>{label}</Text>
    </Pressable>
  );
}

function AddChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.addChip} onPress={onPress}>
      <Ionicons name={icon} size={16} color={palette.accent} />
      <Text style={styles.addChipText}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({
  icon,
  color = palette.textDim,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  label?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.iconBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

/** egy réteg sora a listában (csoport-tag esetén behúzva). */
function LayerRow({
  doc,
  layer: l,
  indented,
  selected: sel,
  onSelect,
  commit,
  t,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  indented: boolean;
  selected: boolean;
  onSelect: (id: string | null) => void;
  commit: (next: ImageDoc, label?: string) => void;
  t: TFn;
}) {
  // 🖐️ húzásos sorrend: a lista fölül a legfelső réteg, ezért lefelé húzva csökken az index
  const [dragY, setDragY] = useState(0);
  const finishDrag = (dy: number) => {
    setDragY(0);
    const steps = Math.round(dy / LAYER_ROW_STEP);
    if (steps !== 0) {
      const from = doc.layers.findIndex((x) => x.id === l.id);
      commit(moveLayerTo(doc, l.id, from - steps), t('studio.image.undoReorder'));
    }
  };
  const drag = Gesture.Pan()
    .withTestId(`layer-drag-${l.id}`)
    .runOnJS(true)
    .minDistance(2)
    .onUpdate((e) => setDragY(e.translationY))
    .onEnd((e) => finishDrag(e.translationY))
    .onFinalize((_e, success) => {
      if (!success) {
        setDragY(0);
      }
    });

  return (
    <Pressable
      onPress={() => onSelect(sel ? null : l.id)}
      style={[
        styles.layerRow,
        indented ? styles.layerIndent : null,
        sel ? styles.layerActive : null,
        dragY !== 0 ? [styles.layerDragging, { transform: [{ translateY: dragY }] }] : null,
      ]}
    >
      <GestureDetector gesture={drag}>
        <View style={styles.dragHandle} accessibilityLabel={t('studio.image.reorderHandle')}>
          <Ionicons name="reorder-three" size={20} color={palette.textDim} />
        </View>
      </GestureDetector>
      <Text style={styles.layerIcon}>{layerIcon(l)}</Text>
      <Text style={[styles.layerName, l.hidden ? styles.hidden : null]} numberOfLines={1}>
        {layerLabel(l)}
      </Text>
      <IconBtn
        icon={l.hidden ? 'eye-off-outline' : 'eye-outline'}
        color={l.hidden ? palette.textDim : palette.text}
        label={t('studio.image.undoVisibility')}
        onPress={() => commit(toggleLayerHidden(doc, l.id), t('studio.image.undoVisibility'))}
      />
      <IconBtn
        icon={l.locked ? 'lock-closed' : 'lock-open-outline'}
        color={l.locked ? palette.accent : palette.textDim}
        label={t('studio.image.undoLock')}
        onPress={() => commit(toggleLayerLocked(doc, l.id), t('studio.image.undoLock'))}
      />
    </Pressable>
  );
}

/** 🗂️ csoport-fejléc: összecsukás, név, közös opacity, elrejt, feloldás. */
function GroupHeader({
  doc,
  group: g,
  commit,
  onSelect,
  t,
}: {
  doc: ImageDoc;
  group: ImageGroup;
  commit: (next: ImageDoc, label?: string) => void;
  onSelect: (id: string | null) => void;
  t: TFn;
}) {
  return (
    <View style={styles.groupWrap}>
      <View style={styles.groupHead}>
        <IconBtn
          icon={g.collapsed ? 'chevron-forward' : 'chevron-down'}
          color={palette.text}
          onPress={() => commit(updateGroup(doc, g.id, { collapsed: !g.collapsed }), 'group-collapse')}
        />
        <Ionicons name="folder-outline" size={14} color={palette.accent} />
        <TextInput
          style={[styles.groupName, styles.groupNameInput, g.hidden ? styles.hidden : null]}
          defaultValue={g.name}
          key={`gname-${g.id}`}
          returnKeyType="done"
          accessibilityLabel={t('studio.image.groupName')}
          onEndEditing={(e) => {
            const name = e.nativeEvent.text.trim();
            if (name && name !== g.name) {
              commit(updateGroup(doc, g.id, { name }), 'group-rename');
            }
          }}
        />
        <IconBtn
          icon={g.hidden ? 'eye-off-outline' : 'eye-outline'}
          color={g.hidden ? palette.textDim : palette.text}
          onPress={() => commit(updateGroup(doc, g.id, { hidden: !g.hidden }), 'group-hide')}
        />
        <IconBtn
          icon="remove-circle-outline"
          color={palette.accent2}
          onPress={() => {
            onSelect(null);
            commit(ungroup(doc, g.id), 'ungroup');
          }}
        />
      </View>
      {!g.collapsed ? (
        <Slider
          label={t('studio.image.opacity')}
          value={g.opacity ?? 1}
          min={0.05}
          max={1}
          onChange={(v) => commit(updateGroup(doc, g.id, { opacity: v }), 'group-opacity')}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  groupNameInput: { padding: 0, minHeight: 32 },
  dragHandle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  layerDragging: { zIndex: 10, opacity: 0.92 },
  chipDisabled: { opacity: 0.4 },
  opsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  layerActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}1a` },
  layerIndent: { marginLeft: 16, borderColor: `${palette.accent}55` },
  groupWrap: {
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${palette.accent}55`,
    backgroundColor: `${palette.accent}0d`,
    padding: 6,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  groupName: { flex: 1, color: palette.text, fontSize: 12, fontWeight: '800' },
  layerIcon: { fontSize: 14 },
  layerName: { flex: 1, color: palette.text, fontSize: 12, fontWeight: '600' },
  hidden: { color: palette.textDim, textDecorationLine: 'line-through' },
  inspector: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 12,
    marginTop: 4,
  },
  inspectorTitle: { color: palette.text, fontSize: 13, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  addRow: { flexDirection: 'row', gap: 8 },
  addChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
  },
  addChipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
});
