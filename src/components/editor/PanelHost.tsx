import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { AdjustPanel } from '@/components/editor/panels/AdjustPanel';
import { AssistantPanel } from '@/components/editor/panels/AssistantPanel';
import { PipPanel } from '@/components/editor/panels/PipPanel';
import { AudioPanel } from '@/components/editor/panels/AudioPanel';
import { CaptionsPanel } from '@/components/editor/panels/CaptionsPanel';
import { ImageDocPanel } from '@/components/editor/panels/ImageDocPanel';
import { ExportPanel } from '@/components/editor/panels/ExportPanel';
import { FilterPanel } from '@/components/editor/panels/FilterPanel';
import { HotspotPanel } from '@/components/editor/panels/HotspotPanel';
import { LibraryPanel } from '@/components/editor/panels/LibraryPanel';
import { MulticamPanel } from '@/components/editor/panels/MulticamPanel';
import { PrecisionPanel } from '@/components/editor/panels/PrecisionPanel';
import { ShapePanel } from '@/components/editor/panels/ShapePanel';
import { SpeedPanel } from '@/components/editor/panels/SpeedPanel';
import { StickerPanel } from '@/components/editor/panels/StickerPanel';
import { TextPanel } from '@/components/editor/panels/TextPanel';
import { TranscriptPanel } from '@/components/editor/panels/TranscriptPanel';
import { TransitionPanel } from '@/components/editor/panels/TransitionPanel';
import { palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import {
  selectPanelVisible,
  selectSelectedClip,
  useEditorStore,
} from '@/store/editorStore';

// A panelcímek fordítása a render-helyen történik (nyelvváltásra reagál):
// t('editor.panelHost.title_' + activePanel)

/**
 * Az aktív szerkesztő-panel.
 *
 *  • `sheet`  (telefon/tablet-álló): alulról feljövő lap az idővonal helyén.
 *  • `docked` (iPad fekvő/desktop): teljes magasságú inspector-oszlop JOBB
 *    oldalon — így a panel ÉS az idővonal egyszerre látszik, nem váltják ki
 *    egymást. Ez a klasszikus vágó-elrendezés (előnézet + inspector + idővonal).
 */
export function PanelHost({ variant = 'sheet' }: { variant?: 'sheet' | 'docked' }) {
  const activePanel = useEditorStore((s) => s.activePanel);
  const visible = useEditorStore(selectPanelVisible);
  const setPanel = useEditorStore((s) => s.setPanel);
  const selected = useEditorStore(selectSelectedClip);
  const L = useLayout();
  const { t } = useTranslation();

  if (!activePanel || !visible) {
    return null;
  }

  let content = null;
  switch (activePanel) {
    case 'text':
      content = selected?.kind === 'text' ? <TextPanel clip={selected} /> : null;
      break;
    case 'filter':
      content =
        selected?.kind === 'video' || selected?.kind === 'image' ? (
          <FilterPanel clip={selected} />
        ) : null;
      break;
    case 'speed':
      content = selected?.kind === 'video' ? <SpeedPanel clip={selected} /> : null;
      break;
    case 'audio':
      content = <AudioPanel clip={selected?.kind === 'audio' ? selected : null} />;
      break;
    case 'hotspot':
      content = selected?.kind === 'interactive' ? <HotspotPanel clip={selected} /> : null;
      break;
    case 'captions':
      content = <CaptionsPanel />;
      break;
    case 'sticker':
      content = <StickerPanel />;
      break;
    case 'assistant':
      content = <AssistantPanel />;
      break;
    case 'transition':
      content =
        selected?.kind === 'video' || selected?.kind === 'image' ? (
          <TransitionPanel clip={selected} />
        ) : null;
      break;
    case 'precision':
      content = selected ? <PrecisionPanel clip={selected} /> : null;
      break;
    case 'library':
      content = <LibraryPanel />;
      break;
    case 'transcript':
      content = <TranscriptPanel />;
      break;
    case 'shape':
      content = selected?.kind === 'shape' ? <ShapePanel clip={selected} /> : null;
      break;
    case 'adjust':
      content = selected?.kind === 'adjust' ? <AdjustPanel clip={selected} /> : null;
      break;
    case 'pip':
      content =
        selected?.kind === 'video' || selected?.kind === 'image' ? (
          <PipPanel clip={selected} />
        ) : null;
      break;
    case 'imagedoc':
      content = <ImageDocPanel />;
      break;
    case 'export':
      content = <ExportPanel />;
      break;
    case 'multicam':
      content = <MulticamPanel />;
      break;
  }

  const docked = variant === 'docked';
  // lapként: állóban a képernyő ~38%-a (az előnézet kiférjen), fekvőben több.
  // dokkoltan a magasságot a szülő oszlop adja (flex), nincs korlát.
  const sheetMaxHeight = L.isLandscape
    ? Math.round(L.height * 0.62)
    : Math.min(L.isCompact ? 320 : 420, Math.round(L.height * 0.38));

  return (
    <View
      style={[
        styles.container,
        docked
          ? [styles.docked, { paddingTop: L.spacing.sm }]
          : { maxHeight: sheetMaxHeight },
      ]}
    >
      {docked ? null : <View style={styles.grabber} />}
      <View style={[styles.header, { paddingHorizontal: L.spacing.lg }]}>
        <Text style={[styles.title, { fontSize: L.font(13) }]}>
          {t('editor.panelHost.title_' + activePanel)}
        </Text>
        <Pressable
          onPress={() => setPanel(null)}
          hitSlop={12}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('editor.panelHost.closePanel')}
        >
          <Ionicons
            name={docked ? 'close' : 'chevron-down'}
            size={20}
            color={palette.textDim}
          />
        </Pressable>
      </View>
      <ScrollView
        style={[docked ? { flex: 1 } : null, { paddingHorizontal: L.spacing.lg }]}
        contentContainerStyle={{ paddingBottom: L.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {content}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: palette.border,
  },
  // dokkolt inspector: teljes magasságú oszlop, csak bal szegéllyel
  docked: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderLeftWidth: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  title: {
    color: palette.text,
    fontWeight: '700',
  },
});
