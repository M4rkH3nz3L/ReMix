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
  // REFACTOR: az AudioLayer.tsx-ből kiemelt részek (a gyökér maga is memoizált marad)
  ['src/components/preview/audio/MixEngineLayer.tsx', 'MixEngineLayer'],
  ['src/components/preview/audio/TrackAudio.tsx', 'TrackAudio'],
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
  // REFACTOR: az AudioPanel.tsx szekciói (a gyökér előtte és utána is kimarad: ref-írás renderben)
  ['src/components/editor/panels/audio/LibrarySection.tsx', 'LibrarySection'],
  ['src/components/editor/panels/audio/AudioSourceSections.tsx', 'OwnFileSection'],
  ['src/components/editor/panels/audio/AudioSourceSections.tsx', 'VoiceoverSection'],
  ['src/components/editor/panels/audio/TtsSection.tsx', 'TtsSection'],
  ['src/components/editor/panels/audio/BeatSection.tsx', 'BeatSection'],
  ['src/components/editor/panels/audio/ClipMixSection.tsx', 'ClipMixSection'],
  ['src/components/editor/panels/audio/AudioFxSection.tsx', 'AudioFxSection'],
  // REFACTOR: a Hang Stúdió ClipEditSheet.tsx-ének szekciói (a gyökér kimarad, lásd lent)
  ['src/components/studio/audio/clipEdit/TempoMatchRow.tsx', 'TempoMatchRow'],
  ['src/components/studio/audio/clipEdit/ClipLevelSection.tsx', 'ClipLevelSection'],
  ['src/components/studio/audio/clipEdit/ClipAutomationSection.tsx', 'ClipAutomationSection'],
  ['src/components/studio/audio/clipEdit/ClipToggleSection.tsx', 'ClipToggleSection'],
  ['src/components/studio/audio/clipEdit/AiDenoiseSection.tsx', 'AiDenoiseSection'],
  ['src/components/studio/audio/clipEdit/VoiceTuneSection.tsx', 'VoiceTuneSection'],
  ['src/components/studio/audio/clipEdit/FxOrderSection.tsx', 'FxOrderSection'],
  ['src/components/studio/audio/clipEdit/ClipToolsSection.tsx', 'ClipToolsSection'],
  // REFACTOR: a Live Studio (src/app/live/studio/[id].tsx) kiemelt renderelő részei (a gyökér kimarad, lásd lent)
  ['src/components/live/studio/LiveCanvas.tsx', 'LiveCanvas'],
  ['src/components/live/studio/ScenesPanel.tsx', 'ScenesPanel'],
  ['src/components/live/studio/SourcesPanel.tsx', 'SourcesPanel'],
  ['src/components/live/studio/StreamConfigPanels.tsx', 'DestinationsPanel'],
  ['src/components/live/studio/StreamConfigPanels.tsx', 'RecordPanel'],
  ['src/components/live/studio/StreamConfigPanels.tsx', 'MultistreamPanel'],
  ['src/components/live/studio/MixerPanel.tsx', 'MixerPanel'],
  ['src/components/live/studio/AddRtmpModal.tsx', 'AddRtmpModal'],
  ['src/components/live/studio/LiveStudioChrome.tsx', 'LiveStudioLoadError'],
  ['src/components/live/studio/LiveStudioChrome.tsx', 'LiveStudioLoading'],
  ['src/components/live/studio/LiveStudioChrome.tsx', 'LiveStudioTopBar'],
  ['src/components/live/studio/LiveStudioChrome.tsx', 'StartStreamBar'],
  // REFACTOR: a 3D Stúdió (Model3DStudio.tsx) részei — rögzítés, feldolgozás, néző (a gyökér kimarad, lásd lent)
  ['src/components/studio/model3d/capture/CaptureModePicker.tsx', 'CaptureModePicker'],
  ['src/components/studio/model3d/capture/ModeCard.tsx', 'ModeCard'],
  ['src/components/studio/model3d/capture/MeshScanScreen.tsx', 'MeshScanScreen'],
  ['src/components/studio/model3d/capture/ObjectCaptureScreen.tsx', 'ObjectCaptureScreen'],
  ['src/components/studio/model3d/capture/RoomScanScreen.tsx', 'RoomScanScreen'],
  ['src/components/studio/model3d/processing/ReconstructingScreen.tsx', 'ReconstructingScreen'],
  ['src/components/studio/model3d/render/Model3DViewer.tsx', 'Model3DViewer'],
  ['src/components/studio/model3d/render/ModelViewport.tsx', 'ModelViewport'],
  ['src/components/studio/model3d/render/StudioHeader.tsx', 'StudioHeader'],
  ['src/components/studio/model3d/render/ViewerInfoPanel.tsx', 'ViewerInfoPanel'],
  ['src/components/studio/model3d/render/ViewerToolbar.tsx', 'ViewerToolbar'],
  ['src/components/studio/model3d/render/ViewerToolbar.tsx', 'Tool'],
  // REFACTOR: az élő adás képernyőjének (src/app/live/[id].tsx) kiemelt renderelő részei (a gyökér előtte és utána is kimarad)
  ['src/components/live/session/LiveSessionStages.tsx', 'ConnectingStage'],
  ['src/components/live/session/LiveSessionStages.tsx', 'LiveVideoUnavailable'],
  ['src/components/live/session/LiveSessionStages.tsx', 'LiveTimer'],
  ['src/components/live/session/LiveVideoLayer.tsx', 'LiveVideoLayer'],
  ['src/components/live/session/LiveSessionTopBar.tsx', 'LiveSessionTopBar'],
  ['src/components/live/session/LiveErrorBanner.tsx', 'LiveErrorBanner'],
  ['src/components/live/session/LiveSceneSwitcher.tsx', 'LiveSceneSwitcher'],
  ['src/components/live/session/LiveChatPanel.tsx', 'LiveChatPanel'],
  // REFACTOR: a useFeed.ts-ből kiemelt rész-hookok (a gyökér előtte és utána is kimarad); a kimenetük identitása a golden trace-ben fordítóval is azonos
  ['src/hooks/feed/useFeedSelection.ts', 'useFeedSelection'],
  ['src/hooks/feed/useFeedPlaybackState.ts', 'useFeedPlaybackState'],
  ['src/hooks/feed/useFeedLoader.ts', 'useFeedLoader'],
  // REFACTOR: a TextPanel.tsx szekciói (a gyökér kimarad, lásd lent)
  ['src/components/editor/panels/text/TextContentSections.tsx', 'TextContentSections'],
  ['src/components/editor/panels/text/TextLookSections.tsx', 'TextLookSections'],
  ['src/components/editor/panels/text/TypographySections.tsx', 'TypographySection'],
  ['src/components/editor/panels/text/TypographySections.tsx', 'TextSizeSection'],
  ['src/components/editor/panels/text/TextStyleSection.tsx', 'TextStyleSection'],
  ['src/components/editor/panels/text/Text3dSection.tsx', 'Text3dSection'],
  ['src/components/editor/panels/text/TextAnimSections.tsx', 'TextAnimSections'],
  ['src/components/editor/panels/text/TextExtraSections.tsx', 'TextLayoutSections'],
  ['src/components/editor/panels/text/TextExtraSections.tsx', 'ToShapeSection'],
  ['src/components/editor/panels/text/TextTrackingSection.tsx', 'TextTrackingSection'],
  // REFACTOR: a CaptionsPanel.tsx szekciói (a gyökér kimarad, lásd lent)
  ['src/components/editor/panels/captions/AutoCaptionSection.tsx', 'AutoCaptionSection'],
  ['src/components/editor/panels/captions/CaptionStudioSection.tsx', 'CaptionStudioSection'],
  ['src/components/editor/panels/captions/CaptionInputSections.tsx', 'CaptionInputSections'],
  ['src/components/editor/panels/captions/CaptionRewriteSections.tsx', 'CaptionRewriteSections'],
  // REFACTOR: a belépés-képernyő (src/app/auth.tsx) kiemelt lapjai (a gyökér előtte és utána is kimarad, lásd lent)
  ['src/components/auth/SignInCard.tsx', 'SignInCard'],
  ['src/components/auth/SignUpCard.tsx', 'SignUpCard'],
  ['src/components/auth/AuthStepCards.tsx', 'MfaChallengeCard'],
  ['src/components/auth/AuthStepCards.tsx', 'SmsOtpCard'],
  ['src/components/auth/AuthStepCards.tsx', 'CheckEmailCard'],
  // REFACTOR: a csatorna-képernyő (src/app/channel/[id].tsx) és kiemelt részei (a gyökér maga is memoizált marad)
  ['src/app/channel/[id].tsx', 'ChannelScreen'],
  ['src/components/channel/ChannelTopBar.tsx', 'ChannelTopBar'],
  ['src/components/channel/ChannelProfileHeader.tsx', 'ChannelProfileHeader'],
  ['src/components/channel/ChannelGridItem.tsx', 'ChannelGridItem'],
  ['src/components/channel/ChannelSheets.tsx', 'PromoteSheet'],
  ['src/components/channel/ChannelSheets.tsx', 'RemixModerationSheet'],
  // REFACTOR: a StickerPanel.tsx szekciói (a gyökér kimarad, lásd lent)
  ['src/components/editor/panels/sticker/StickerShapesSection.tsx', 'StickerShapesSection'],
  ['src/components/editor/panels/sticker/StickerFxSections.tsx', 'ParticlesSection'],
  ['src/components/editor/panels/sticker/StickerFxSections.tsx', 'DrawSection'],
  ['src/components/editor/panels/sticker/Sticker3dSection.tsx', 'Sticker3dSection'],
  ['src/components/editor/panels/sticker/EmojiStickerSections.tsx', 'FaceStickerSection'],
  ['src/components/editor/panels/sticker/EmojiStickerSections.tsx', 'TapStickerSection'],
  // REFACTOR: a LibraryPanel.tsx szekciói (a gyökér maga is memoizált marad)
  ['src/components/editor/panels/library/UrlImportSection.tsx', 'UrlImportSection'],
  ['src/components/editor/panels/library/ProviderSection.tsx', 'ProviderSection'],
  ['src/components/editor/panels/LibraryPanel.tsx', 'LibraryPanel'],
  // REFACTOR: a TextOverlay.tsx betű-rétegei (a gyökér kimarad, lásd lent: Reanimated shared value írása)
  ['src/components/preview/textOverlay/TextOverlayGlyphs.tsx', 'TextOverlayGlyphs'],
  // REFACTOR: az „Új projekt" modal (CreateProjectModal.tsx) szekciói (a gyökér kimarad, lásd lent; a ref-es SeoFields előtte is kimaradt volna)
  ['src/components/studio/createProject/KindPicker.tsx', 'KindPicker'],
  ['src/components/studio/createProject/KindOptionsSections.tsx', 'VideoAspectSection'],
  ['src/components/studio/createProject/KindOptionsSections.tsx', 'DesignTemplateSection'],
  ['src/components/studio/createProject/KindOptionsSections.tsx', 'AudioOptionsSection'],
  ['src/components/studio/createProject/KindOptionsSections.tsx', 'Model3dFormatSection'],
  ['src/components/studio/createProject/ImageOptionsSection.tsx', 'ImageOptionsSection'],
  ['src/components/studio/createProject/SourceFolderSection.tsx', 'SourceFolderSection'],
  // REFACTOR: a pénztárca-kártya (WalletCard.tsx) szekciói; a BucketRow előtte is memoizált volt (a gyökér kimarad, lásd lent)
  ['src/components/profile/wallet/BucketRow.tsx', 'BucketRow'],
  ['src/components/profile/wallet/WalletBalanceSection.tsx', 'WalletBalanceSection'],
  ['src/components/profile/wallet/CoinSubscriptionSection.tsx', 'CoinSubscriptionSection'],
  ['src/components/profile/wallet/GiftSection.tsx', 'GiftSection'],
  ['src/components/profile/wallet/CashoutSection.tsx', 'CashoutSection'],
  ['src/components/profile/wallet/WalletHistory.tsx', 'WalletHistory'],
  // REFACTOR: a tárhely-kártya (StorageCard.tsx) szekciói; a Stepper előtte is memoizált volt (a gyökér kimarad, lásd lent)
  ['src/components/profile/storage/Stepper.tsx', 'Stepper'],
  ['src/components/profile/storage/StorageUsageSection.tsx', 'StorageUsageSection'],
  ['src/components/profile/storage/ExternalStorageSection.tsx', 'ExternalStorageSection'],
  ['src/components/profile/storage/ManualProviderModal.tsx', 'ManualProviderModal'],
  // REFACTOR: a useProfile.ts és a useStudio.ts kiemelt rész-hookjai (a gyökerek kimaradnak, lásd lent); a kimenetük identitása a golden trace-ben fordítóval is azonos
  ['src/hooks/profile/useProfileSession.ts', 'useProfileSession'],
  ['src/hooks/profile/useProfileState.ts', 'useProfileState'],
  ['src/hooks/profile/useProfilePerformance.ts', 'useProfilePerformance'],
  ['src/hooks/profile/useProfileLoaders.ts', 'useProfileLoaders'],
  ['src/hooks/studio/useStudioLoaders.ts', 'useStudioLoaders'],
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
  ['src/components/editor/panels/PrecisionPanel.tsx', 'PrecisionPanel', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],  ['src/components/studio/audio/ClipEditSheet.tsx', 'ClipEditSheet', 'a füstteszt-hookok refjeit (onDoneRef/presetRef/editInstRef) renderben írja'],
  ['src/components/studio/audio/clipEdit/FxParamsSection.tsx', 'FxParamsSection', 'a parametrikus EQ patch-e template-literál kulcsú objektum (a fordító még nem támogatja)'],
  ['src/components/studio/audio/clipEdit/FxPresetsSection.tsx', 'FxPresetsSection', 'a füstteszt görgetési pontját (presetsY ref) az onLayout írja'],
  ['src/app/live/studio/[id].tsx', 'LiveStudioScreen', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/studio/model3d/Model3DStudio.tsx', 'Model3DStudio', 'a bejövő fájl egyszeri importjánál az eslint-disable react-hooks/exhaustive-deps kikapcsolja a fordítót (a bontás előtt is)'],
  ['src/hooks/useFeed.ts', 'useFeed', 'a tap-gesztus refjeit (onTapItemRef/onDoubleTapRef) renderben írja (a bontás előtt: expo-video player-mutáció)'],
  ['src/hooks/feed/useFeedTapGesture.ts', 'useFeedTapGesture', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/hooks/feed/useActivePostEffects.ts', 'useActivePostEffects', 'az onViewable useRef(…).current-jét renderben olvassa'],
  ['src/hooks/feed/useFeedAnimations.ts', 'useFeedAnimations', 'az Animated.Value refek .current-jét renderben olvassa'],
  ['src/hooks/feed/useFeedSeekVolume.ts', 'useFeedSeekVolume', 'expo-video player-mutáció (volume/muted/currentTime) és ref-írás renderben'],
  ['src/components/editor/panels/TextPanel.tsx', 'TextPanel', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/editor/panels/CaptionsPanel.tsx', 'CaptionsPanel', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/app/auth.tsx', 'AuthScreen', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/editor/panels/CaptionsPanel.tsx', 'CaptionsPanel', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],  ['src/components/editor/panels/StickerPanel.tsx', 'StickerPanel', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/studio/CreateProjectModal.tsx', 'CreateProjectModal', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/profile/WalletCard.tsx', 'WalletCard', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/components/profile/StorageCard.tsx', 'StorageCard', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/hooks/useProfile.ts', 'useProfile', "szándékos 'use no memo': a bontás után fordítható lenne, de a memoizálás bekapcsolása viselkedés-változás — külön döntés"],
  ['src/hooks/profile/useProfileImage.ts', 'useProfileImage', 'try/finally a feltöltés-handlerekben (a fordító még nem támogatja; a bontás előtt a gyökér ugyanezért maradt ki)'],
  ['src/hooks/profile/useProfileSubscription.ts', 'useProfileSubscription', 'try/finally a DEV Pro-handlerekben (a fordító még nem támogatja; a bontás előtt a gyökér ugyanezért maradt ki)'],
  ['src/hooks/useStudio.ts', 'useStudio', 'a füstteszt createRef-jét renderben írja (a bontás előtt: eslint-disable react-hooks/exhaustive-deps is)'],
  ['src/hooks/studio/useOpenFromStorage.ts', 'useOpenFromStorage', 'a paraméter-kulcsos effekt eslint-disable react-hooks/exhaustive-deps-e kikapcsolja a fordítót (a bontás előtt is)'],
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
