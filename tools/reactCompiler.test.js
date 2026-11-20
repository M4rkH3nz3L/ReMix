const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

/**
 * 🧭 Őr a React Compiler memoizálására a FORRÓ útvonalon.
 *
 * A projektnek nincs kézi `useMemo`-ja a szerkesztőben: az EGYETLEN memoizálási
 * stratégia a fordító. Ha egy komponens kiesik az optimalizálásból, azt ma
 * semmi nem jelzi — a lint hallgat, a build zöld, csak a telefon lesz lassabb.
 *
 * KOMPONENSENKÉNT mér, nem fájlonként. Ez lényeges: egy fájlban együtt élhet
 * lefordult és kimaradt függvény (a `TimelineClip.tsx`-ben például a kis
 * `EdgeThumb` segéd lefordult, miközben a FŐ `TimelineClip` kimaradt — a REFACTOR óta
 * az `EdgeThumb` a `timelineClip/` alatt él), ezért a
 * fájl-szintű „van-e benne `_c(`" mérés HAMIS biztonságot ad.
 *
 * A mérés a VALÓDI fordítási úton történik (`babel-preset-expo`,
 * `caller.supportsReactCompiler: true`, ahogy a Metro hívja), és nem a fordító
 * naplójára hagyatkozik, hanem a KIMENETRE: a memoizált függvény törzse
 * `$ = _c(n)`-nel kezdődik.
 *
 * A lista szándékosan kétirányúan „kirögzített": elbukik, ha valami visszaesik,
 * ÉS akkor is, ha egy ismert kimaradó megjavul — így nem tud sem némán nőni,
 * sem elavulni.
 */

const ROOT = path.join(__dirname, '..');

/** fájl → a benne memoizálandó komponensek (a lejátszás alatt dolgozók) */
const MUST_BE_MEMOIZED = [
  ['src/components/preview/AudioLayer.tsx', 'AudioLayer'],
  ['src/components/preview/PipLayer.tsx', 'PipLayer'],
  ['src/components/preview/PipLayer.tsx', 'PipClipFrame'],
  ['src/components/preview/TransitionLayer.tsx', 'TransitionLayer'],
  ['src/components/preview/TransitionLayer.tsx', 'IncomingClip'],
  ['src/components/preview/ShapeOverlay.tsx', 'ShapeOverlay'],
  // REFACTOR: a Timeline.tsx-ből kiemelt, tisztán renderelő részek (a gyökér maga kimarad, lásd lent)
  ['src/components/editor/timeline/TimelineControlsBar.tsx', 'TimelineControlsBar'],
  ['src/components/editor/timeline/TimelineRuler.tsx', 'TimelineRuler'],
  ['src/components/editor/timeline/TimelineTrackRow.tsx', 'TimelineTrackRow'],
  ['src/components/editor/timeline/TrackHeaderColumn.tsx', 'TrackHeaderColumn'],
  ['src/components/editor/timeline/FloatingTrackLabels.tsx', 'FloatingTrackLabels'],
  ['src/components/editor/timeline/TimelineGuideLines.tsx', 'TimelineGuideLines'],
  // REFACTOR: az AssistantPanel.tsx-ből kiemelt szekciók (a gyökér és a hookok kimaradnak: getState a renderben, try/finally)
  ['src/components/editor/panels/assistant/AutoEditSection.tsx', 'AutoEditSection'],
  ['src/components/editor/panels/assistant/CommandBarSection.tsx', 'CommandBarSection'],
  ['src/components/editor/panels/assistant/CutToolsSection.tsx', 'CutToolsSection'],
  ['src/components/editor/panels/assistant/InstructionSection.tsx', 'InstructionSection'],
  ['src/components/editor/panels/assistant/SocialPresetsSection.tsx', 'SocialPresetsSection'],
  ['src/components/editor/panels/assistant/SuggestionSection.tsx', 'SuggestionSection'],
  // REFACTOR: a PreviewSurface.tsx-ből kiemelt renderelő részek
  ['src/components/preview/surface/CanvasMarkers.tsx', 'MaskShade'],
  ['src/components/preview/surface/CanvasMarkers.tsx', 'FaceBlurMarker'],
  ['src/components/preview/surface/CanvasMarkers.tsx', 'BlackScrim'],
  ['src/components/preview/surface/CanvasMarkers.tsx', 'SmartGuideLines'],
  ['src/components/preview/surface/CanvasMarkers.tsx', 'StrokePreview'],
  ['src/components/preview/surface/CompareSlider.tsx', 'CompareSlider'],
  ['src/components/preview/surface/LookLayers.tsx', 'FilterLookLayer'],
  ['src/components/preview/surface/LookLayers.tsx', 'LightingTintLayer'],
  ['src/components/preview/surface/LookLayers.tsx', 'AdjustTintLayers'],
  ['src/components/preview/surface/LookLayers.tsx', 'AdjustTrackTintLayers'],
  ['src/components/preview/surface/PreviewMedia.tsx', 'BlurBackdrop'],
  ['src/components/preview/surface/PreviewMedia.tsx', 'MediaLayer'],
  ['src/components/preview/surface/PreviewToolbar.tsx', 'PreviewToolbar'],
  // REFACTOR: a szerkesztő-képernyő (src/app/editor/[id].tsx) kiemelt renderelő részei
  ['src/components/editor/screen/EditorBanners.tsx', 'EditorBanners'],
  ['src/components/editor/screen/EditorHeader.tsx', 'EditorHeader'],
  ['src/components/editor/screen/EditorLayoutBody.tsx', 'EditorLayoutBody'],
  ['src/components/editor/screen/MissingProjectView.tsx', 'MissingProjectView'],
  ['src/components/editor/screen/ProjectMenuSheet.tsx', 'ProjectMenuSheet'],
  // REFACTOR: a TimelineClip.tsx-ből kiemelt renderelő részek (a gyökér TimelineClipInner kimarad, lásd lent)
  ['src/components/editor/timelineClip/ClipEdgePreview.tsx', 'ClipEdgePreview'],
  ['src/components/editor/timelineClip/ClipEdgePreview.tsx', 'EdgeThumb'],
  ['src/components/editor/timelineClip/ClipLabel.tsx', 'ClipLabel'],
  ['src/components/editor/timelineClip/ClipLockBadge.tsx', 'ClipLockBadge'],
  ['src/components/editor/timelineClip/ClipTrimHandles.tsx', 'ClipTrimHandles'],
  // REFACTOR: a Toolbar.tsx-ből kiemelt renderelő részek (a gyökér maga is memoizált marad)
  ['src/components/editor/toolbar/ToolbarToolRow.tsx', 'ToolCell'],
  ['src/components/editor/toolbar/ToolbarToolRow.tsx', 'ToolbarToolRow'],
  ['src/components/editor/toolbar/MoreToolsSheet.tsx', 'MoreToolsSheet'],
  ['src/components/editor/Toolbar.tsx', 'Toolbar'],
  // REFACTOR: az ExportPanel.tsx-ből kiemelt szekciók (a gyökér kimarad, lásd lent)
  ['src/components/editor/panels/export/AdvancedExportControls.tsx', 'AdvancedExportControls'],
  ['src/components/editor/panels/export/CaptionsSection.tsx', 'CaptionsSection'],
  ['src/components/editor/panels/export/InteractiveSection.tsx', 'InteractiveSection'],
  ['src/components/editor/panels/export/PostSection.tsx', 'PostSection'],
  ['src/components/editor/panels/export/ProStatusBanner.tsx', 'ProStatusBanner'],
  ['src/components/editor/panels/export/ProjectFileSection.tsx', 'ProjectFileSection'],
  ['src/components/editor/panels/export/ThumbnailStudioSection.tsx', 'ThumbnailStudioSection'],
  ['src/components/editor/panels/export/VideoExportSection.tsx', 'VideoExportSection'],
  // REFACTOR: a Kép Stúdió LayerInspector.tsx-ének szekciói (a gyökér maga is memoizált marad)
  ['src/components/studio/image/inspector/TextLayerSection.tsx', 'TextLayerSection'],
  ['src/components/studio/image/inspector/PhotoLayerSection.tsx', 'PhotoLayerSection'],
  ['src/components/studio/image/inspector/AdjustLayerSection.tsx', 'AdjustLayerSection'],
  ['src/components/studio/image/inspector/ShapeLayerSection.tsx', 'ShapeLayerSection'],
  ['src/components/studio/image/inspector/FillLayerSection.tsx', 'FillLayerSection'],
  ['src/components/studio/image/inspector/LayerCompositeSection.tsx', 'LayerCompositeSection'],
  ['src/components/studio/image/inspector/LayerEffectsSection.tsx', 'LayerEffectsSection'],
  ['src/components/studio/image/inspector/MaskFadeSection.tsx', 'MaskFadeSection'],
  ['src/components/studio/image/LayerInspector.tsx', 'LayerInspector'],
  // REFACTOR: az ImageCanvas.tsx-ből kiemelt renderelő részek (a gyökér kimarad, lásd lent)
  ['src/components/studio/image/canvas/CanvasLayerStack.tsx', 'CanvasLayerStack'],
  ['src/components/studio/image/canvas/CanvasMarks.tsx', 'MultiSelectOutlines'],
  ['src/components/studio/image/canvas/CanvasMarks.tsx', 'PasteboardVeil'],
  ['src/components/studio/image/canvas/CanvasMarks.tsx', 'SmartGuideMarks'],
  ['src/components/studio/image/canvas/EditOverlays.tsx', 'EditOverlays'],
  ['src/components/studio/image/canvas/GuideOverlays.tsx', 'GuideOverlays'],
  ['src/components/studio/image/canvas/SelectionOverlays.tsx', 'SelectionOverlays'],
  // REFACTOR: az ImageStudioBody.tsx-ből kiemelt renderelő részek (a gyökér maga kimarad: ref-írás renderben)
  ['src/components/studio/image/body/ActiveModeBar.tsx', 'ActiveModeBar'],
  ['src/components/studio/image/body/DockedLayerPanel.tsx', 'DockedLayerPanel'],
  // REFACTOR: a ShapePanel.tsx szekciói (a gyökér maga is memoizált marad)
  ['src/components/editor/panels/shape/ShapeGeometrySections.tsx', 'ShapeGeometrySections'],
  ['src/components/editor/panels/shape/BooleanSection.tsx', 'BooleanSection'],
  ['src/components/editor/panels/shape/ShapeFillSection.tsx', 'ShapeFillSection'],
  ['src/components/editor/panels/shape/ShapeStyleSections.tsx', 'ShapeStyleSections'],
  ['src/components/editor/panels/shape/ShapeStyleSections.tsx', 'ShapeAlignSection'],
  ['src/components/editor/panels/shape/GlowOutlineSection.tsx', 'GlowOutlineSection'],
  ['src/components/editor/panels/shape/ShapeTrackSection.tsx', 'ShapeTrackSection'],
  ['src/components/editor/panels/ShapePanel.tsx', 'ShapePanel'],
  // REFACTOR: a PrecisionPanel.tsx szekciói (a gyökér kimarad, lásd lent)
  ['src/components/editor/panels/precision/TimingSections.tsx', 'TimebaseSection'],
  ['src/components/editor/panels/precision/TimingSections.tsx', 'TimingSection'],
  ['src/components/editor/panels/precision/TimingSections.tsx', 'AlignSection'],
  ['src/components/editor/panels/precision/KeyframesSection.tsx', 'KeyframesSection'],
  ['src/components/editor/panels/precision/AppearanceSection.tsx', 'AppearanceSection'],
  ['src/components/editor/panels/precision/ImageTrackSection.tsx', 'ImageTrackSection'],
  ['src/components/editor/panels/precision/CompoundSection.tsx', 'CompoundSection'],
  // REFACTOR: az AudioStudioBody.tsx-ből kiemelt renderelő részek (a gyökér maga kimarad: ref-írás renderben)
  ['src/components/studio/audio/body/InstrumentOverlays.tsx', 'InstrumentOverlays'],
  ['src/components/studio/audio/body/MultiSelectBar.tsx', 'MultiSelectBar'],
];

/**
 * Ismert, ELFOGADOTT kimaradások — mindegyikhez az OK, hogy a következő olvasó
 * ne kezdje elölről a nyomozást.
 *
 * Közös nevező: expo-video/expo-audio player-mutáció vagy Reanimated shared
 * value írása. Ezekre az `AGENTS.md` szándékosan kikapcsolta a
 * `react-hooks/immutability` és `react-hooks/refs` szabályokat — a fordító
 * viszont ugyanezeket látja, és emiatt hagyja ki a komponenst.
 */
const KNOWN_BAILS = [
  ['src/components/editor/Timeline.tsx', 'Timeline', 'a virtualizációs ablak renderben olvassa a lastScrollX refet'],
  // a komponens neve a forrásban TimelineClipInner; a `TimelineClip` a memo() burkolat
  ['src/components/editor/TimelineClip.tsx', 'TimelineClipInner', 'Reanimated shared value mutációk'],
  ['src/components/preview/PreviewSurface.tsx', 'PreviewSurface', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/editor/panels/ExportPanel.tsx', 'ExportPanel', 'a füstteszt-hook renderben írja az exportLocalRef refet'],
  ['src/app/editor/[id].tsx', 'EditorScreen', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/preview/TextOverlay.tsx', 'TextOverlay', 'Reanimated shared value írása'],
  ['src/components/studio/image/ImageCanvas.tsx', 'ImageCanvas', 'a nézet-gesztusok refjeit (zoomRef/panRef/fitRef) renderben írja'],
  ['src/components/editor/panels/PrecisionPanel.tsx', 'PrecisionPanel', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
];

const cache = new Map();
function transformed(relPath) {
  if (cache.has(relPath)) {
    return cache.get(relPath);
  }
  const file = path.join(ROOT, relPath);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [[require.resolve('babel-preset-expo'), {}]],
    configFile: false,
    babelrc: false,
    // pontosan azok a caller-jelzések, amikkel a Metro hívja a presetet; a
    // fordítót a `supportsReactCompiler` kapcsolja be, NEM preset-opció
    // (babel-preset-expo build/common.js: getReactCompiler)
    caller: {
      name: 'metro',
      platform: 'ios',
      isDev: false,
      supportsStaticESM: true,
      supportsReactCompiler: true,
    },
  });
  cache.set(relPath, code);
  return code;
}

/** a memoizált függvény törzse `$ = _c(n)`-nel nyit */
function isMemoized(relPath, fnName) {
  const code = transformed(relPath);
  if (!new RegExp(`function\\s+${fnName}\\s*\\(`).test(code)) {
    throw new Error(`${fnName} nem található a ${relPath} kimenetében — átnevezték?`);
  }
  return new RegExp(
    `function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{\\s*(?:var|const|let)\\s+\\$\\s*=\\s*_c\\(`
  ).test(code);
}

describe('React Compiler — a forró útvonal memoizálása', () => {
  it.each(MUST_BE_MEMOIZED)('%s · %s memoizálva van', (file, fn) => {
    expect(isMemoized(file, fn)).toBe(true);
  });

  it.each(KNOWN_BAILS)('%s · %s még mindig kimarad (%s)', (file, fn) => {
    // ha ez elbukik, az JÓ hír: vedd ki a KNOWN_BAILS-ből, és tedd át a
    // MUST_BE_MEMOIZED-ba, hogy ne tudjon visszaesni
    expect(isMemoized(file, fn)).toBe(false);
  });

  it('a mérőműszer maga is működik (különben mindent „kimaradtnak" látnánk)', () => {
    const probe = path.join(ROOT, 'tools', '__probe.tsx');
    fs.writeFileSync(
      probe,
      `import { Text } from 'react-native';
       export function Probe({ items }: { items: string[] }) {
         return <Text>{items.map((s) => s.toUpperCase()).join(', ')}</Text>;
       }`
    );
    try {
      // egy triviálisan fordítható komponens MUSZÁJ hogy memoizálódjon — ha nem,
      // akkor a caller-konfig romlott el, és a fenti állítások értéktelenek
      expect(isMemoized('tools/__probe.tsx', 'Probe')).toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
