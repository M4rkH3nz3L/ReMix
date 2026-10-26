import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { FocusChrome } from '@/components/editor/FocusChrome';
import {
  FilterQuick,
  SpeedQuick,
  TransitionQuick,
  VolumeQuick,
} from '@/components/editor/panels/QuickPanels';
import { InlineSheet } from '@/components/ui/InlineSheet';

import { AdjustPanel } from '@/components/editor/panels/AdjustPanel';
import { AssistantPanel } from '@/components/editor/panels/AssistantPanel';
import { PipPanel } from '@/components/editor/panels/PipPanel';
import { AudioPanel } from '@/components/editor/panels/AudioPanel';
import { CaptionsPanel } from '@/components/editor/panels/CaptionsPanel';
import { CreatorPresetPanel } from '@/components/editor/panels/CreatorPresetPanel';
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
import { WorkflowPanel } from '@/components/editor/panels/WorkflowPanel';
import { palette } from '@/constants/editor';
import { motion, radius } from '@/design';
import { useBackLayer } from '@/hooks/useBackLayer';
import { useLayout } from '@/hooks/useLayout';
import type { Detent } from '@/lib/panelLayout';
import { videoPanelSpec } from '@/lib/panelSpecs';
import {
  selectPanelVisible,
  selectSelectedClip,
  selectSurfaceTier,
  useEditorStore,
} from '@/store/editorStore';

// A panelcímek fordítása a render-helyen történik (nyelvváltásra reagál):
// t('editor.panelHost.title_' + activePanel)

/**
 * Az aktív szerkesztő-panel — a felület-SZINT szerint (MOBILE-UI §3, regiszter:
 * `@/lib/panelSpecs`):
 *
 *  • `strip`  — gyors beállítás az eszköztár HELYÉN (chip-sor + finomhangoló);
 *               a „Részletek" ugyanazt a panelt sheet-szintre bontja.
 *  • `sheet`  — NEM-modális, detentes inline lap (peek/half/full): a fölötte lévő
 *               előnézet újraméreteződik, nem takarja semmi. A detenteket a
 *               képernyő adja (`layoutBudget`), így a vászon-garancia egy helyen dől el.
 *  • `focus`  — precíziós mód: a króm a vászon FÖLÉ úszik (a képernyő ilyenkor
 *               mindent elrejt a vásznon kívül).
 *  • `docked` (variant; iPad fekvő/desktop): teljes magasságú inspector-oszlop
 *               JOBB oldalon — ott elég a hely, ezért mindig a teljes panel él.
 */
export function PanelHost({
  variant = 'sheet',
  detents,
}: {
  variant?: 'sheet' | 'docked';
  /** a Sheet detentjei px-ben (a képernyő `layoutBudget`-jéből); nélküle a régi fix lap */
  detents?: Record<Detent, number>;
}) {
  const activePanel = useEditorStore((s) => s.activePanel);
  const visible = useEditorStore(selectPanelVisible);
  const tier = useEditorStore(selectSurfaceTier);
  const panelDetent = useEditorStore((s) => s.panelDetent);
  const setPanelDetent = useEditorStore((s) => s.setPanelDetent);
  const expandPanel = useEditorStore((s) => s.expandPanel);
  const panelFocus = useEditorStore((s) => s.panelFocus);
  const setPanelFocus = useEditorStore((s) => s.setPanelFocus);
  const setPanel = useEditorStore((s) => s.setPanel);
  const selected = useEditorStore(selectSelectedClip);
  const L = useLayout();
  const { t } = useTranslation();
  // ↩️ vissza: Focus-ból (lapról kért) a laphoz, egyébként a panel zárul
  useBackLayer(
    activePanel && visible
      ? panelFocus
        ? () => setPanelFocus(false)
        : () => setPanel(null)
      : null
  );

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
    case 'creatorPreset':
      content = <CreatorPresetPanel />;
      break;
    case 'workflow':
      content = <WorkflowPanel />;
      break;
  }

  const docked = variant === 'docked';
  const title = t('editor.panelHost.title_' + activePanel);
  const close = () => setPanel(null);

  // ⚡ STRIP — a gyors változat (ha a panelnek van; különben a teljes tartalom sheet-ben)
  if (!docked && tier === 'strip') {
    let quick = null;
    if (activePanel === 'speed' && selected?.kind === 'video') {
      quick = <SpeedQuick clip={selected} />;
    } else if (activePanel === 'filter' && (selected?.kind === 'video' || selected?.kind === 'image')) {
      quick = <FilterQuick clip={selected} />;
    } else if (activePanel === 'transition' && (selected?.kind === 'video' || selected?.kind === 'image')) {
      quick = <TransitionQuick clip={selected} />;
    } else if (activePanel === 'audio' && selected?.kind === 'audio') {
      quick = <VolumeQuick clip={selected} />;
    }
    if (quick) {
      return (
        <Animated.View
          entering={SlideInDown.duration(motion.duration.base).easing(motion.easing.standard)}
          style={[styles.strip, { paddingHorizontal: L.spacing.md }]}
        >
          <View style={styles.stripHead}>
            <Text style={[styles.title, { fontSize: L.font(13) }]} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              onPress={expandPanel}
              hitSlop={8}
              style={styles.detailsButton}
              accessibilityRole="button"
              accessibilityLabel={t('editor.panelHost.details')}
            >
              <Ionicons name="options-outline" size={14} color={palette.accent} />
              <Text style={styles.detailsText}>{t('editor.panelHost.details')}</Text>
            </Pressable>
            <Pressable
              onPress={close}
              hitSlop={10}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('editor.panelHost.closePanel')}
            >
              <Ionicons name="checkmark" size={20} color={palette.text} />
            </Pressable>
          </View>
          <Animated.View key={activePanel} entering={FadeIn.duration(motion.duration.fast)}>
            {quick}
          </Animated.View>
        </Animated.View>
      );
    }
  }

  // 🎯 FOCUS — a vászon fölé úszó króm (a képernyő minden mást elrejt)
  if (!docked && tier === 'focus') {
    return (
      // a lapról kért (canFocus) Focus „Kész"-e a laphoz visz vissza, nem zár
      <FocusChrome title={title} onDone={panelFocus ? () => setPanelFocus(false) : close}>
        {content}
      </FocusChrome>
    );
  }

  // 📄 SHEET — inline, detentes lap (ha a képernyő detenteket ad)
  if (!docked && detents) {
    return (
      <InlineSheet
        detents={detents}
        detent={panelDetent}
        onDetentChange={setPanelDetent}
        onClose={close}
        accessibilityLabel={title}
        header={
          <View style={[styles.header, { paddingHorizontal: L.spacing.lg }]}>
            <Text style={[styles.title, styles.flexTitle, { fontSize: L.font(13) }]} numberOfLines={1}>
              {title}
            </Text>
            {videoPanelSpec(activePanel)?.canFocus ? (
              // 🎯 a tárgy pozicionálása teljes vásznon (húzás/méretezés), lap nélkül
              <Pressable
                onPress={() => setPanelFocus(true)}
                hitSlop={8}
                style={styles.detailsButton}
                accessibilityRole="button"
                accessibilityLabel={t('editor.panelHost.focusCanvas')}
              >
                <Ionicons name="scan-outline" size={14} color={palette.accent} />
                <Text style={styles.detailsText}>{t('editor.panelHost.focusCanvas')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={close}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('editor.panelHost.closePanel')}
            >
              <Ionicons name="close" size={20} color={palette.textDim} />
            </Pressable>
          </View>
        }
      >
        <ScrollView
          style={{ paddingHorizontal: L.spacing.lg }}
          contentContainerStyle={{ paddingBottom: L.spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View key={activePanel} entering={FadeIn.duration(motion.duration.fast)}>
            {content}
          </Animated.View>
        </ScrollView>
      </InlineSheet>
    );
  }

  // (tartalék) fix lap — detentek nélküli hívónál; a telefonos képernyők a fenti
  // inline Sheet-et kapják. Dokkoltan a szülő oszlop adja a magasságot.
  // A bezárás megtartja a kijelölést — `setPanel(null)` nem törli. §2.4
  const sheetMaxHeight = L.isLandscape
    ? Math.round(L.height * 0.62)
    : Math.min(L.isCompact ? 320 : 420, Math.round(L.height * 0.38));

  return (
    <Animated.View
      // belépő: lapként alulról rugózik fel, dokkoltan finoman beúszik.
      // Panelek KÖZÖTT nincs remount (a shell marad) — csak a tartalom morfol lent.
      entering={
        docked
          ? FadeIn.duration(motion.duration.base)
          : SlideInDown.duration(motion.duration.slow).easing(motion.easing.standard)
      }
      style={[
        styles.container,
        docked
          ? [styles.docked, { paddingTop: L.spacing.sm }]
          : { maxHeight: sheetMaxHeight },
      ]}
    >
      {docked ? null : <View style={styles.grabber} />}
      <View style={[styles.header, { paddingHorizontal: L.spacing.lg }]}>
        <Text style={[styles.title, { fontSize: L.font(13) }]}>{title}</Text>
        <Pressable
          onPress={close}
          hitSlop={12}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('editor.panelHost.closePanel')}
        >
          <Ionicons name={docked ? 'close' : 'chevron-down'} size={20} color={palette.textDim} />
        </Pressable>
      </View>
      <ScrollView
        style={[docked ? { flex: 1 } : null, { paddingHorizontal: L.spacing.lg }]}
        contentContainerStyle={{ paddingBottom: L.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {/* a panel-váltás tartalom-MORF: a keret marad, a tartalom átúszik */}
        <Animated.View key={activePanel} entering={FadeIn.duration(motion.duration.fast)}>
          {content}
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
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
  // ⚡ Strip: az eszköztár helyén, felső hairline-nal, lekerekítés nélkül
  strip: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 6,
    paddingBottom: 6,
  },
  stripHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: 10,
    marginLeft: 'auto',
    borderRadius: 8,
    backgroundColor: palette.accentSoft,
  },
  detailsText: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '700',
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
    gap: 8,
    paddingVertical: 8,
  },
  flexTitle: { flex: 1 },
  title: {
    color: palette.text,
    fontWeight: '700',
  },
});
