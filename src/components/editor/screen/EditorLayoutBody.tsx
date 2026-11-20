import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SourceBin } from '@/components/SourceBin';
import { MiniTimeline } from '@/components/editor/MiniTimeline';
import { PanelHost } from '@/components/editor/PanelHost';
import { SelectionInfo } from '@/components/editor/SelectionInfo';
import { Timeline } from '@/components/editor/Timeline';
import { Toolbar } from '@/components/editor/Toolbar';
import { TransportBar } from '@/components/editor/TransportBar';
import { PreviewSurface } from '@/components/preview/PreviewSurface';
import { Toast } from '@/components/ui/Toast';
import { palette } from '@/constants/editor';
import type { Layout } from '@/hooks/useLayout';
import { editorLayoutKind } from '@/lib/editorScreenOps';
import type { LayoutBudget } from '@/lib/panelLayout';
import { useEditorStore } from '@/store/editorStore';

/**
 * 📐 A szerkesztő törzse méret-osztály szerint (expanded / medium-fekvő /
 * medium-álló / compact) — a függőleges rakás mért body-jával. A fejléc és a
 * sávok kész elemként érkeznek. A szerkesztő-képernyőből kiemelve.
 */
export function EditorLayoutBody({
  L,
  focus,
  panelVisible,
  surfaceTier,
  budget,
  header,
  banners,
  setBodyH,
  setTransportH,
  setTimelineH,
}: {
  L: Layout;
  focus: boolean;
  panelVisible: boolean;
  surfaceTier: 'strip' | 'sheet' | 'focus' | null;
  budget: LayoutBudget;
  header: ReactNode;
  banners: ReactNode;
  setBodyH: (h: number) => void;
  setTransportH: (h: number) => void;
  setTimelineH: (h: number) => void;
}) {
  // a függőleges (telefon-álló / iPad-álló) rakás — a body-t MÉRJÜK, abból számol a budget
  const stackedWork = (
    <View style={styles.stackBody} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
      {/* Focusban a preview a felső fókusz-sáv ALÁ kerül, hogy a saját sarokgombjai
          (teljes képernyő, összehasonlítás) ne takaródjanak (T1/6). A burkoló mindig ott
          van → a fókuszváltás nem mountolja újra a lejátszót. */}
      <View style={[styles.stackBody, focus ? styles.focusPreview : null]}>
        <PreviewSurface mode="edit" />
      </View>
      {focus ? (
        // 🎯 Focus: a króm a vászon FÖLÉ úszik, minden más rejtve
        <PanelHost />
      ) : (
        <>
          <View onLayout={(e) => setTransportH(e.nativeEvent.layout.height)}>
            <TransportBar />
          </View>
          {budget.timelineMode === 'full' ? (
            <View onLayout={(e) => setTimelineH(e.nativeEvent.layout.height)}>
              <Timeline compact={surfaceTier !== null} />
            </View>
          ) : budget.timelineMode === 'mini' ? (
            <MiniTimeline />
          ) : null}
          {surfaceTier === 'sheet' || surfaceTier === 'strip' ? (
            <PanelHost detents={budget.detents} />
          ) : null}
          {/* 🍞 a toast az eszköztár (vagy a lap) FÖLÖTT úszik — a horgony a rakás alja */}
          <View style={styles.toastAnchor}>
            <Toast />
            {budget.toolbarVisible ? <Toolbar /> : null}
          </View>
        </>
      )}
    </View>
  );

  const kind = editorLayoutKind(L);
  let body: React.ReactNode;
  if (kind === 'expanded') {
    body = (
      <>
        {header}
        {banners}
        <View style={styles.expandedBand}>
          {/* 🧰 bal eszköz-rail: az alsó eszköztár helyett (MOBILE-UI §7) — így a
              vászon és az idővonal magasságot nyer, az eszközök hüvelykujj-közelben */}
          <View style={{ width: L.editor.railWidth }}>
            <Toolbar variant="rail" />
          </View>
          {L.editor.sourceBinWidth > 0 ? (
            <View style={[styles.sourceDock, { width: L.editor.sourceBinWidth }]}>
              <SourceBin compact scroll onInsert={(a) => useEditorStore.getState().insertSourceAsset(a)} />
            </View>
          ) : null}
          <View style={styles.expandedCenter}>
            <PreviewSurface mode="edit" />
            <TransportBar />
          </View>
          {panelVisible ? (
            <View style={{ width: L.editor.inspectorWidth }}>
              <PanelHost variant="docked" />
            </View>
          ) : null}
        </View>
        <SelectionInfo />
        <Timeline />
        <View style={styles.toastAnchor}>
          <Toast />
        </View>
      </>
    );
  } else if (kind === 'mediumLandscape') {
    body = (
      <View style={styles.landscapeRow}>
        <View style={styles.landscapePreview}>
          <PreviewSurface mode="edit" />
        </View>
        <View style={styles.landscapeSide}>
          {header}
          {banners}
          <TransportBar />
          <View style={styles.landscapeSideBody}>
            {panelVisible ? (
              <>
                {/* az idővonal NEM tűnik el: mini-sor; a ⌃ bezárja a panelt */}
                <MiniTimeline onExpand={() => useEditorStore.getState().setPanel(null)} />
                <PanelHost variant="docked" />
              </>
            ) : (
              <Timeline />
            )}
          </View>
          <View style={styles.toastAnchor}>
            <Toast />
            {panelVisible ? null : <Toolbar />}
          </View>
        </View>
      </View>
    );
  } else if (kind === 'medium') {
    body = (
      <>
        {focus ? null : header}
        {focus ? null : banners}
        <View style={styles.expandedBand}>
          {L.editor.sourceBinWidth > 0 && !focus ? (
            <View style={[styles.sourceDock, { width: L.editor.sourceBinWidth }]}>
              <SourceBin compact scroll onInsert={(a) => useEditorStore.getState().insertSourceAsset(a)} />
            </View>
          ) : null}
          {stackedWork}
        </View>
      </>
    );
  } else {
    body = (
      <>
        {focus ? null : header}
        {focus ? null : banners}
        {stackedWork}
      </>
    );
  }

  return body;
}

const styles = StyleSheet.create({
  landscapeRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // expanded/medium-álló középső sáv: előnézet | (dokkolt inspector)
  expandedBand: {
    flex: 1,
    flexDirection: 'row',
  },
  expandedCenter: {
    flex: 1,
  },
  // 🗂️ mindig-látható dokkolt forrás-mappa (bal oszlop, tablet/fekvő)
  sourceDock: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: palette.border,
  },
  // 📐 a függőleges rakás mért body-ja (a layoutBudget bemenete)
  stackBody: {
    flex: 1,
  },
  // a FocusChrome felső sávja (44 + 2×8 margó) alá
  focusPreview: {
    paddingTop: 60,
  },
  toastAnchor: {
    position: 'relative',
  },
  landscapePreview: {
    flex: 1,
  },
  landscapeSide: {
    width: '52%',
    maxWidth: 480,
    borderLeftWidth: 1,
    borderLeftColor: palette.border,
  },
  landscapeSideBody: {
    flex: 1,
  },
});
