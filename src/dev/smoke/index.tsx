/**
 * 🧪 Képernyős füstteszt (dev-only) — a fázis-elosztó. A fázisok funkció szerint a ./suites/<terület>/ csomagokban,
 * a közös segédek a ./helpers/, a fixture-ök a ./fixtures/ alatt vannak (gyűjtő: ./shared.tsx).
 * Csak a dev-image-smoke route tölti be dinamikusan, __DEV__ vagy EXPO_PUBLIC_RELEASE_SMOKE mögött.
 */
import type { ReactNode } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { BrushBar } from '@/components/studio/image/body/BrushBar';
import { SelectionBar } from '@/components/studio/image/body/SelectionBar';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { previewEngine } from '@/lib/previewEngine';
import '@/lib/dspNativeClient';
import { supabase } from '@/lib/supabase';
import { applyRing, rectRing } from '@/lib/selection';
import { DEFAULT_BRUSH } from '@/lib/brushEngine';
import { useEditorStore } from '@/store/editorStore';
import { smokeAiDenoise, smokeAiDrums, smokeAiModels, smokeAiShot, smokeAiUndo, smokeHumMelody, smokeModelDownload, smokeSpeechEdit, smokeSpeechHu, smokeStemDevice, smokeStemExport, smokeStemsUi, smokeTtsDevice, smokeWhisperProbe } from './suites/ai';
import { inspectProjects, killPhase1, killPhase2, smokeActionMenu, smokeAutosave, smokeGestureScreens, smokeLogin, smokeMenus, smokeNewerSchema, smokeWorker, startFreezeWatch } from './suites/app';
import { smokeA11y, smokeAbCompare, smokeAlbumSheet, smokeAudioAssistant, smokeAudioCheck, smokeAudioEdge, smokeAudioFit, smokeAudioFormat, smokeAudioKillPrepare, smokeAudioKillVerify, smokeAudioMarkers, smokeAudioMeter, smokeAudioMix, smokeAudioRemix, smokeAudioRuler, smokeAudioSync, smokeAudioTags, smokeAudioTemplate, smokeBeatSplit, smokeBleed, smokeBpmOffline, smokeBusParity, smokeC7, smokeChords, smokeClipGain, smokeClipboard, smokeCloudLibrary, smokeConsole, smokeCrossfade, smokeDecodeDiag, smokeDecodeWindowed, smokeDenoise, smokeDenoiseNative, smokeDesignEntry, smokeDiskSpace, smokeDrumKit, smokeDspNative, smokeDspProf, smokeEngineFx, smokeEngineSpike, smokeEngineStudio, smokeEqSweep, smokeExportGap, smokeExportProfile, smokeExtSync, smokeFormant, smokeFormantNative, smokeFreeFx, smokeFromVideo, smokeFxAutomation, smokeFxOrder, smokeFxParams, smokeGapEdit, smokeInstrumentDock, smokeInstrumentEdit, smokeInstruments, smokeInterrupt, smokeLinkedImage, smokeLinkedMix, smokeLiveLufs, smokeLongCodec, smokeLongSource, smokeLongWave, smokeLoopClip, smokeLoops, smokeMasterDyn, smokeMeter, smokeMetronome, smokeMidi, smokeMixAssist, smokeModeShot, smokeMusicWorkspace, smokeOfflineExport, smokeOfflineFx, smokeOfflineSpeed, smokePerfMatrix, smokePianoRoll2, smokePitchSpike, smokePresetPhoto, smokePreviewEngine, smokeProExport, smokePunch, smokeRecPause, smokeRecording, smokeRefAB, smokeRemixTracks, smokeRemixTracksProd, smokeRemoteGain, smokeRouteChange, smokeSampleGrid, smokeSampler2, smokeShiftLatency, smokeShopPack, smokeSidechain, smokeSilence, smokeSoundPack, smokeStudioModes, smokeTakes, smokeTempoMap, smokeTempoMatch, smokeThermal, smokeTouchModes, smokeTracksBuses, smokeUsages, smokeUserPresets, smokeVelSwing, smokeVelTouch, smokeVideoRef, smokeVocalTune, smokeWavOptions, smokeWaveform, smokeWaveformBackground, smokeWorkflow } from './suites/audio';
import { smokeCollabCleanup, smokeCollabMember, smokeCollabOwner, smokeLockMember, smokeLockOwner, smokeLockPersist, smokeWhoAmI } from './suites/collab';
import { smokeAdjustHsl, smokeAssistant, smokeBgRemove, smokeBoolean, smokeBrandLogo, smokeBrush, smokeBrushEngine, smokeCanvasOps, smokeCapture, smokeClipMask, smokeClipText, smokeColor, smokeColorIntake, smokeColorRange, smokeCornerPin, smokeDeep, smokeDeep2, smokeDeep3, smokeEcosystem, smokeFontImport, smokeFrameShot, smokeGrid, smokeImportExport, smokeInnerFx, smokeIntake, smokeLeading, smokeLensFx, smokeLooks, smokeMaskFollow, smokeNetwork, smokeOfflineImg, smokePaintMask, smokeParity, smokePasteboard, smokePathOps, smokePdfOffline, smokePerf, smokePerfPhotos, smokePixel, smokePixelSharp, smokeQuickCreate, smokeRefineEdge, smokeRemix, smokeRetouch, smokeSelectText, smokeSelection, smokeSheets, smokeStraighten, smokeStrokeAlign, smokeTemplateLibrary, smokeTextFx, smokeVariant, smokeVector, smokeWand, smokeZoomCanvas } from './suites/image';
import { smokeLiveHost, smokeLiveRecord, smokeLiveStudio, smokeLiveView } from './suites/live';
import { smokeAudioReverse, smokeAudioSpeed, smokeExportFree, smokeNativeSpeed, smokeOfflineStretch, smokeQuickVolume, smokeShuttle, smokeStillRender, smokeTextOverlay, smokeThumbDoc, smokeTimelineZoom, smokeVideoAudioExport, smokeVideoSync } from './suites/video';
import { type Log, sleep } from './shared';
export { tabletProject, firstImageProjectId } from './shared';

export async function runImageSmoke(
  phase: string,
  log: Log,
  setHarness: (n: ReactNode) => void,
  ratio: number,
  killId: string
): Promise<void> {
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      log(false, name, String((e as Error)?.message ?? e).slice(0, 300));
    }
  };
  if (phase === 'kill1') {
    await step('kill1', () => killPhase1(log, setHarness, killId));
    return;
  }
  if (phase === 'kill2') {
    await step('kill2', () => killPhase2(log, killId));
    return;
  }
  if (phase === 'ui') {
    startFreezeWatch(log);
    return;
  }
  if (phase === 'inspect') {
    await step('inspect', () => inspectProjects(log));
    return;
  }
  if (phase === 'selectbar') {
    await step('selectbar', async () => {
      setHarness(
        <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center' }}>
          <SelectionBar tool="rect" mode="subtract" selection={applyRing(null, rectRing({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }), 'new')} canUseLayer canShape={false} onTool={() => {}} onMode={() => {}} onInvert={() => {}} onFeather={() => {}} onAction={() => {}} onClear={() => {}} onDone={() => {}} />
        </View>
      );
      log(true, 'FOTÓZHATÓ', 'a kijelölés sávja a kijelzőn');
      await sleep(6000);
      setHarness(null);
    });
    return;
  }
  if (phase === 'color') {
    await step('color', () => smokeColor(log, setHarness, ratio));
    return;
  }
  if (phase === 'shuttle') {
    await step('shuttle', () => smokeShuttle(log));
    return;
  }
  if (phase === 'studio') {
    await step('studio', () => smokeLiveStudio(log));
    return;
  }
  if (phase === 'actionmenu') {
    await step('actionmenu', () => smokeActionMenu(log));
    return;
  }
  if (phase === 'login') {
    await step('login', () => smokeLogin(log));
    return;
  }
  if (phase === 'wavereset' || phase === 'wavebg') {
    await step(phase, () => smokeWaveformBackground(log, phase === 'wavereset'));
    return;
  }
  if (phase === 'waveform') {
    await step('waveform', () => smokeWaveform(log));
    return;
  }
  if (phase === 'audiomix') {
    await step('audiomix', () => smokeAudioMix(log, setHarness));
    return;
  }
  if (phase === 'audioruler' || phase === 'audiolock') {
    await step(phase, () => smokeAudioRuler(log, phase === 'audiolock'));
    return;
  }
  if (phase === 'albumsheet') {
    await step('albumsheet', () => smokeAlbumSheet(log, setHarness));
    return;
  }
  if (phase === 'offlinespeed') {
    await step('offlinespeed', () => smokeOfflineSpeed(log));
    return;
  }
  if (phase === 'videosync') {
    await step('videosync', () => smokeVideoSync(log));
    return;
  }
  if (phase === 'audioedge') {
    await step('audioedge', () => smokeAudioEdge(log));
    return;
  }
  if (phase === 'audiotags') {
    await step('audiotags', () => smokeAudioTags(log));
    return;
  }
  if (phase === 'videoaudio') {
    await step('videoaudio', () => smokeVideoAudioExport(log, setHarness));
    return;
  }
  if (phase === 'audiofit') {
    await step('audiofit', () => smokeAudioFit(log));
    return;
  }
  if (phase === 'audiometer') {
    await step('audiometer', () => smokeAudioMeter(log));
    return;
  }
  if (phase === 'audiosync') {
    // a klipenkénti lejátszók szinkronja (a még csak a renderben szóló effektes projektek útja)
    previewEngine.forceFallback = true;
    try {
      await step('audiosync', () => smokeAudioSync(log));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'offline') {
    await step('offline', () => smokeOfflineExport(log));
    return;
  }
  if (phase === 'bleed') {
    await step(phase, () => smokeBleed(log));
    return;
  }
  if (phase === 'dspnative') {
    await step(phase, () => smokeDspNative(log));
    return;
  }
  if (phase === 'dspprof') {
    await step(phase, () => smokeDspProf(log));
    return;
  }
  if (phase === 'videoref') {
    await step(phase, () => smokeVideoRef(log));
    return;
  }
  if (phase === 'audiotemplate') {
    await step(phase, () => smokeAudioTemplate(log));
    return;
  }
  if (phase === 'quickvol') {
    await step(phase, () => smokeQuickVolume(log));
    return;
  }
  if (phase === 'ttsdevice') {
    await step(phase, () => smokeTtsDevice(log));
    return;
  }
  if (phase === 'metronome') {
    await step(phase, () => smokeMetronome(log));
    return;
  }
  if (phase === 'bpmoffline') {
    await step(phase, () => smokeBpmOffline(log));
    return;
  }
  if (phase === 'instredit') {
    await step(phase, () => smokeInstrumentEdit(log));
    return;
  }
  if (phase === 'newerschema') {
    await step(phase, () => smokeNewerSchema(log));
    return;
  }
  if (phase === 'veltouch') {
    await step(phase, () => smokeVelTouch(log));
    return;
  }
  if (phase === 'velswing') {
    await step(phase, () => smokeVelSwing(log));
    return;
  }
  if (phase === 'audioremix') {
    await step(phase, () => smokeAudioRemix(log));
    return;
  }
  if (phase === 'refab') {
    await step(phase, () => smokeRefAB(log));
    return;
  }
  if (phase === 'masterdyn') {
    await step(phase, () => smokeMasterDyn(log));
    return;
  }
  if (phase === 'fxorder') {
    await step(phase, () => smokeFxOrder(log));
    return;
  }
  if (phase === 'remotegain') {
    await step(phase, () => smokeRemoteGain(log));
    return;
  }
  if (phase === 'lockpersist') {
    await step(phase, () => smokeLockPersist(log));
    return;
  }
  if (phase === 'lockowner') {
    await step(phase, () => smokeLockOwner(log));
    return;
  }
  if (phase === 'lockmember') {
    await step(phase, () => smokeLockMember(log));
    return;
  }
  if (phase === 'collabcleanup') {
    await step(phase, () => smokeCollabCleanup(log));
    return;
  }
  if (phase === 'collabowner') {
    await step(phase, () => smokeCollabOwner(log));
    return;
  }
  if (phase === 'collabmember') {
    await step(phase, () => smokeCollabMember(log));
    return;
  }
  if (phase === 'whoami') {
    await step(phase, () => smokeWhoAmI(log));
    return;
  }
  if (phase === 'tempo') {
    await step(phase, () => smokeTempoMatch(log));
    return;
  }
  if (phase === 'fromvideo') {
    await step(phase, () => smokeFromVideo(log));
    return;
  }
  if (phase === 'clipgain') {
    await step(phase, () => smokeClipGain(log));
    return;
  }
  if (phase === 'gapedit') {
    await step(phase, () => smokeGapEdit(log));
    return;
  }
  if (phase === 'livelufs') {
    await step(phase, () => smokeLiveLufs(log));
    return;
  }
  if (phase === 'takes') {
    await step(phase, () => smokeTakes(log));
    return;
  }
  if (phase === 'punch') {
    await step(phase, () => smokePunch(log));
    return;
  }
  if (phase === 'recpause') {
    await step(phase, () => smokeRecPause(log));
    return;
  }
  if (phase === 'exportgap') {
    await step(phase, () => smokeExportGap(log));
    return;
  }
  if (phase === 'longwave') {
    await step(phase, () => smokeLongWave(log));
    return;
  }
  if (phase === 'aiundo') {
    await step(phase, () => smokeAiUndo(log));
    return;
  }
  if (phase === 'longcodec') {
    await step(phase, () => smokeLongCodec(log));
    return;
  }
  if (phase === 'console') {
    await step(phase, () => smokeConsole(log));
    return;
  }
  if (phase === 'touchmodes') {
    await step(phase, () => smokeTouchModes(log));
    return;
  }
  if (phase === 'a11y') {
    await step(phase, () => smokeA11y(log));
    return;
  }
  if (phase === 'thumbdoc') {
    await step(phase, () => smokeThumbDoc(log));
    return;
  }
  if (phase === 'cliptext') {
    await step(phase, () => smokeClipText(log, setHarness));
    return;
  }
  if (phase === 'textoverlay') {
    await step(phase, () => smokeTextOverlay(log));
    return;
  }
  if (phase === 'exportfree') {
    await step(phase, () => smokeExportFree(log));
    return;
  }
  if (phase === 'quickcreate') {
    await step(phase, () => smokeQuickCreate(log));
    return;
  }
  if (phase === 'strokealign') {
    await step(phase, () => smokeStrokeAlign(log, setHarness));
    return;
  }
  if (phase === 'stillrender') {
    await step(phase, () => smokeStillRender(log));
    return;
  }
  if (phase === 'cornerpin') {
    await step(phase, () => smokeCornerPin(log, setHarness));
    return;
  }
  if (phase === 'straighten') {
    await step(phase, () => smokeStraighten(log, setHarness));
    return;
  }
  if (phase === 'clip') {
    await step(phase, () => smokeClipMask(log, setHarness));
    return;
  }
  if (phase === 'frameshot') {
    await step(phase, () => smokeFrameShot(log));
    return;
  }
  if (phase === 'looks') {
    await step(phase, () => smokeLooks(log, setHarness));
    return;
  }
  if (phase === 'refine') {
    await step(phase, () => smokeRefineEdge(log));
    return;
  }
  if (phase === 'adjhsl') {
    await step(phase, () => smokeAdjustHsl(log, setHarness));
    return;
  }
  if (phase === 'seltext') {
    await step(phase, () => smokeSelectText(log, setHarness));
    return;
  }
  if (phase === 'colorrange') {
    await step(phase, () => smokeColorRange(log, setHarness));
    return;
  }
  if (phase === 'intake') {
    await step('intake', () => smokeIntake(log));
    return;
  }
  if (phase === 'colorin') {
    await step(phase, () => smokeColorIntake(log, setHarness));
    return;
  }
  if (phase === 'pixelsharp') {
    await step(phase, () => smokePixelSharp(log, setHarness));
    return;
  }
  if (phase === 'textfx') {
    await step(phase, () => smokeTextFx(log, setHarness));
    return;
  }
  if (phase === 'maskfollow') {
    await step(phase, () => smokeMaskFollow(log, setHarness));
    return;
  }
  if (phase === 'leading') {
    await step(phase, () => smokeLeading(log, setHarness));
    return;
  }
  if (phase === 'lensfx') {
    await step(phase, () => smokeLensFx(log, setHarness));
    return;
  }
  if (phase === 'innerfx') {
    await step(phase, () => smokeInnerFx(log, setHarness));
    return;
  }
  if (phase === 'pdfoffline') {
    await step(phase, () => smokePdfOffline(log, setHarness));
    return;
  }
  if (phase === 'variant') {
    await step(phase, () => smokeVariant(log, setHarness));
    return;
  }
  if (phase === 'brandlogo') {
    await step(phase, () => smokeBrandLogo(log));
    return;
  }
  if (phase === 'fontimport') {
    await step(phase, () => smokeFontImport(log));
    return;
  }
  if (phase === 'templib') {
    await step(phase, () => smokeTemplateLibrary(log, setHarness));
    return;
  }
  if (phase === 'designentry') {
    await step(phase, () => smokeDesignEntry(log));
    return;
  }
  if (phase === 'linkimg') {
    await step(phase, () => smokeLinkedImage(log, setHarness));
    return;
  }
  if (phase === 'linkedmix') {
    await step(phase, () => smokeLinkedMix(log));
    return;
  }
  if (phase === 'musicws') {
    await step(phase, () => smokeMusicWorkspace(log));
    return;
  }
  if (phase === 'pianoroll2') {
    await step(phase, () => smokePianoRoll2(log));
    return;
  }
  if (phase === 'drumkit') {
    await step(phase, () => smokeDrumKit(log));
    return;
  }
  if (phase === 'tempomap') {
    await step(phase, () => smokeTempoMap(log));
    return;
  }
  if (phase === 'instdock') {
    await step(phase, () => smokeInstrumentDock(log));
    return;
  }
  if (phase === 'decwin') {
    await step(phase, () => smokeDecodeWindowed(log));
    return;
  }
  if (phase === 'audiofmt') {
    await step(phase, () => smokeAudioFormat(log));
    return;
  }
  if (phase === 'usages') {
    await step(phase, () => smokeUsages(log));
    return;
  }
  if (phase === 'workflow') {
    await step(phase, () => smokeWorkflow(log));
    return;
  }
  if (phase === 'routechange') {
    await step(phase, () => smokeRouteChange(log));
    return;
  }
  if (phase === 'wavopts') {
    await step(phase, () => smokeWavOptions(log));
    return;
  }
  if (phase === 'samplegrid') {
    await step(phase, () => smokeSampleGrid(log));
    return;
  }
  if (phase === 'fxparam') {
    await step(phase, () => smokeFxParams(log));
    return;
  }
  if (phase === 'freefx') {
    await step(phase, () => smokeFreeFx(log));
    return;
  }
  if (phase === 'formant') {
    await step(phase, () => smokeFormant(log));
    return;
  }
  if (phase === 'decodediag') {
    await step(phase, () => smokeDecodeDiag(log));
    return;
  }
  if (phase === 'loops') {
    await step(phase, () => smokeLoops(log));
    return;
  }
  if (phase === 'cloudlib') {
    await step(phase, () => smokeCloudLibrary(log));
    return;
  }
  if (phase === 'sampler2') {
    await step(phase, () => smokeSampler2(log));
    return;
  }
  if (phase === 'chords') {
    await step(phase, () => smokeChords(log));
    return;
  }
  if (phase === 'vocaltune') {
    await step(phase, () => smokeVocalTune(log));
    return;
  }
  if (phase === 'shiftlat') {
    await step(phase, () => smokeShiftLatency(log));
    return;
  }
  if (phase === 'denoisenative') {
    await step(phase, () => smokeDenoiseNative(log));
    return;
  }
  if (phase === 'formantnative') {
    await step(phase, () => smokeFormantNative(log));
    return;
  }
  if (phase === 'c7') {
    await step(phase, () => smokeC7(log));
    return;
  }
  if (phase === 'sidechain') {
    await step(phase, () => smokeSidechain(log));
    return;
  }
  if (phase === 'busparity') {
    await step(phase, () => smokeBusParity(log));
    return;
  }
  if (phase === 'eqsweep') {
    await step(phase, () => smokeEqSweep(log));
    return;
  }
  if (phase === 'midi') {
    await step(phase, () => smokeMidi(log));
    return;
  }
  if (phase === 'exprofile') {
    await step(phase, () => smokeExportProfile(log));
    return;
  }
  if (phase === 'modeldl') {
    await step(phase, () => smokeModelDownload(log));
    return;
  }
  if (phase === 'mixassist') {
    await step(phase, () => smokeMixAssist(log));
    return;
  }
  if (phase === 'audioassistant') {
    await step(phase, () => smokeAudioAssistant(log));
    return;
  }
  if (phase === 'audiocheck') {
    await step(phase, () => smokeAudioCheck(log));
    return;
  }
  if (phase === 'presetphoto') {
    await step(phase, () => smokePresetPhoto(log));
    return;
  }
  if (phase === 'userpresets') {
    await step(phase, () => smokeUserPresets(log));
    return;
  }
  if (phase === 'instruments') {
    await step(phase, () => smokeInstruments(log));
    return;
  }
  if (phase === 'stemexport') {
    await step(phase, () => smokeStemExport(log));
    return;
  }
  if (phase === 'extsync') {
    await step(phase, () => smokeExtSync(log));
    return;
  }
  if (phase === 'speechhu') {
    await step(phase, () => smokeSpeechHu(log));
    return;
  }
  if (phase === 'speechedit') {
    await step(phase, () => smokeSpeechEdit(log));
    return;
  }
  if (phase === 'whisperprobe') {
    await step(phase, () => smokeWhisperProbe(log));
    return;
  }
  if (phase === 'silence') {
    await step(phase, () => smokeSilence(log));
    return;
  }
  if (phase === 'beatsplit') {
    await step(phase, () => smokeBeatSplit(log));
    return;
  }
  if (phase === 'loopclip') {
    await step(phase, () => smokeLoopClip(log));
    return;
  }
  if (phase === 'meter') {
    await step(phase, () => smokeMeter(log));
    return;
  }
  if (phase === 'clipboard') {
    await step(phase, () => smokeClipboard(log));
    return;
  }
  if (phase === 'tracksbuses') {
    await step(phase, () => smokeTracksBuses(log));
    return;
  }
  if (phase === 'fxautomation') {
    await step(phase, () => smokeFxAutomation(log));
    return;
  }
  if (phase === 'audiomarkers') {
    await step(phase, () => smokeAudioMarkers(log));
    return;
  }
  if (phase === 'abcompare') {
    await step(phase, () => smokeAbCompare(log));
    return;
  }
  if (phase === 'crossfade') {
    await step(phase, () => smokeCrossfade(log));
    return;
  }
  if (phase === 'licshot') {
    router.push('/legal?doc=licenses' as Href);
    log(true, 'FOTÓZHATÓ', 'a nyílt forrású licencek oldala');
    await sleep(15_000);
    router.back();
    return;
  }
  if (phase === 'aishot') {
    await step(phase, () => smokeAiShot(log));
    return;
  }
  if (phase === 'aimodels') {
    await step(phase, () => smokeAiModels(log));
    return;
  }
  if (phase === 'aidenoise') {
    await step(phase, () => smokeAiDenoise(log));
    return;
  }
  if (phase === 'aidrums') {
    await step(phase, () => smokeAiDrums(log));
    return;
  }
  if (phase === 'stemsui') {
    await step(phase, () => smokeStemsUi(log));
    return;
  }
  if (phase === 'stemdevice') {
    await step(phase, () => smokeStemDevice(log));
    return;
  }
  if (phase === 'hummelody') {
    await step(phase, () => smokeHumMelody(log));
    return;
  }
  if (phase === 'remixtracksprod') {
    await step(phase, () => smokeRemixTracksProd(log));
    return;
  }
  if (phase === 'remixtracks') {
    await step(phase, () => smokeRemixTracks(log));
    return;
  }
  if (phase === 'shoppack') {
    await step(phase, () => smokeShopPack(log));
    return;
  }
  if (phase === 'soundpack') {
    await step(phase, () => smokeSoundPack(log));
    return;
  }
  if (phase === 'modeshot') {
    await step(phase, () => smokeModeShot(log));
    return;
  }
  if (phase === 'studiomodes') {
    await step(phase, () => smokeStudioModes(log));
    return;
  }
  if (phase === 'perfmatrix') {
    await step(phase, () => smokePerfMatrix(log));
    return;
  }
  if (phase === 'thermal') {
    await step(phase, () => smokeThermal(log));
    return;
  }
  if (phase === 'longsource') {
    await step(phase, () => smokeLongSource(log));
    return;
  }
  if (phase === 'proexport') {
    await step(phase, () => smokeProExport(log));
    return;
  }
  if (phase === 'denoise') {
    await step(phase, () => smokeDenoise(log));
    return;
  }
  if (phase === 'pitchspike') {
    await step(phase, () => smokePitchSpike(log));
    return;
  }
  if (phase === 'enginefx') {
    await step(phase, () => smokeEngineFx(log));
    return;
  }
  if (phase === 'offlinefx') {
    await step(phase, () => smokeOfflineFx(log));
    return;
  }
  if (phase === 'enginestudio') {
    await step(phase, () => smokeEngineStudio(log, setHarness));
    return;
  }
  if (phase === 'previewengine') {
    await step(phase, () => smokePreviewEngine(log));
    return;
  }
  if (phase === 'enginespike') {
    await step(phase, () => smokeEngineSpike(log));
    return;
  }
  if (phase === 'audioreverse') {
    // a klipenkénti lejátszók útja (a még csak a renderben szóló effektes projekteké) — ezt méri
    previewEngine.forceFallback = true;
    try {
      await step(phase, () => smokeAudioReverse(log));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'nativespeed') {
    await step(phase, () => smokeNativeSpeed(log));
    return;
  }
  if (phase === 'offlinestretch') {
    await step(phase, () => smokeOfflineStretch(log));
    return;
  }
  if (phase === 'audiospeed') {
    // a klipenkénti lejátszók útja (a még csak a renderben szóló effektes projekteké) — ezt méri
    previewEngine.forceFallback = true;
    try {
      await step(phase, () => smokeAudioSpeed(log));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'diskspace') {
    await step(phase, () => smokeDiskSpace(log, setHarness));
    return;
  }
  if (phase === 'interrupt' || phase === 'interruptbg') {
    // a klipenkénti lejátszók útja (a még csak a renderben szóló effektes projekteké) — ezt méri
    previewEngine.forceFallback = true;
    try {
      await step(phase, () => smokeInterrupt(log, setHarness, phase === 'interruptbg'));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'recording') {
    await step('recording', () => smokeRecording(log, setHarness));
    return;
  }
  if (phase === 'audiokill1') {
    await step('audiokill1', () => smokeAudioKillPrepare(log));
    return;
  }
  if (phase === 'audiokill2') {
    await step('audiokill2', () => smokeAudioKillVerify(log));
    return;
  }
  if (phase === 'menus') {
    await step('menus', () => smokeMenus(log, setHarness));
    return;
  }
  if (phase === 'timeline') {
    await step('timeline', () => smokeTimelineZoom(log));
    return;
  }
  if (phase === 'liverecord') {
    await step('liverecord', () => smokeLiveRecord(log, setHarness));
    return;
  }
  if (phase === 'livehost') {
    await step('livehost', () => smokeLiveHost(log));
    return;
  }
  if (phase.startsWith('liveview-')) {
    await step('liveview', () => smokeLiveView(log, phase.slice('liveview-'.length)));
    return;
  }
  if (phase === 'screens') {
    await step('screens', () => smokeGestureScreens(log));
    return;
  }
  if (phase === 'pixel') {
    await step('pixel', () => smokePixel(log, setHarness, ratio));
    return;
  }
  if (phase === 'perfphoto') {
    await step('perfphoto', () => smokePerfPhotos(log, setHarness));
    return;
  }
  if (phase === 'perf') {
    await step('perf', () => smokePerf(log, setHarness));
    return;
  }
  if (phase === 'remix') {
    await step('remix', () => smokeRemix(log, setHarness, ratio));
    return;
  }
  if (phase === 'brand') {
    await step('brand', () => smokeEcosystem(log, setHarness, ratio, true));
    return;
  }
  if (phase === 'eco') {
    await step('eco', () => smokeEcosystem(log, setHarness, ratio));
    return;
  }
  if (phase === 'assistant') {
    await step('assistant', () => smokeAssistant(log, setHarness, ratio));
    return;
  }
  if (phase === 'export13') {
    await step('export13', () => smokeImportExport(log));
    return;
  }
  if (phase === 'grid') {
    await step('grid', () => smokeGrid(log, setHarness, ratio));
    return;
  }
  if (phase === 'pathops') {
    await step('pathops', () => smokePathOps(log, setHarness, ratio));
    return;
  }
  if (phase === 'boolean') {
    await step('boolean', () => smokeBoolean(log, setHarness, ratio));
    return;
  }
  if (phase === 'vector') {
    await step('vector', () => smokeVector(log, setHarness, ratio));
    return;
  }
  if (phase === 'bgremove') {
    await step('bgremove', () => smokeBgRemove(log, setHarness, ratio));
    return;
  }
  if (phase === 'retouch') {
    await step('retouch', () => smokeRetouch(log));
    return;
  }
  if (phase === 'paintmask') {
    await step('paintmask', () => smokePaintMask(log, setHarness, ratio));
    return;
  }
  if (phase === 'logs') {
    await step('logs', async () => {
      // egyedi üzenetű hiba, hogy a szerveren egyértelműen megtalálható legyen
      logCaught('lib/imageSmoke.tsx:logs', new Error(`smoke-naplo-proba ${Platform.OS}`));
      // a Supabase nem dob: a nem létező tábla hibája csak a kérés-szintű naplóból látszik
      const res = await supabase?.from('smoke_nincs_ilyen_tabla').select('id').limit(1);
      log(!!res?.error, 'a Supabase-hiba a hívónak is megmarad', res?.error?.code ?? 'nincs hiba');
      await sleep(4000);
    });
    return;
  }
  if (phase === 'net') {
    await step('net', async () => {
      const probe = async (url: string) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const t0 = Date.now();
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          log(r.ok, 'elérés', `${url} HTTP ${r.status}, ${Date.now() - t0} ms`);
        } catch (e) {
          log(false, 'elérés', `${url} ${String(e).slice(0, 70)}, ${Date.now() - t0} ms`);
        }
        clearTimeout(timer);
      };
      log(true, 'eszköz', Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'telefon');
      await probe('http://192.168.0.34:8081/status');
      await probe('http://192.168.0.34:8787/health');
      await probe('http://192.168.0.34:8081/status');
      await probe('http://192.168.0.34:8787/health');
    });
    return;
  }
  if (phase === 'selection') {
    await step('selection', () => smokeSelection(log, setHarness, ratio));
    return;
  }
  if (phase === 'brushbar') {
    await step('brushbar', async () => {
      setHarness(
        <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center' }}>
          <BrushBar brush={{ ...DEFAULT_BRUSH, tool: 'clone' }} retouch onChange={() => {}} canUndo canRedo={false} onUndo={() => {}} onRedo={() => {}} onCancel={() => {}} onDone={() => {}} />
        </View>
      );
      log(true, 'FOTÓZHATÓ', 'az ecset-sáv a kijelzőn');
      await sleep(7000);
      setHarness(null);
    });
    return;
  }
  if (phase === 'brush') {
    await step('brush', () => smokeBrushEngine(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep3') {
    await step('deep3', () => smokeDeep3(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep2') {
    await step('deep2', () => smokeDeep2(log, setHarness, ratio));
    return;
  }
  if (phase === 'offlineimg') {
    await step('offlineimg', () => smokeOfflineImg(log, setHarness));
    return;
  }
  if (phase === 'deep') {
    await step('deep', () => smokeDeep(log, setHarness, ratio));
    return;
  }
  if (phase === 'parity') {
    await step('parity', () => smokeParity(log));
    return;
  }
  if (phase === 'sheets') {
    await step('sheets', () => smokeSheets(log, setHarness));
    return;
  }
  if (phase === 'pasteboard') {
    await step('pasteboard', () => smokePasteboard(log, setHarness));
    return;
  }
  const online = await smokeNetwork(log);
  await step('brush', () => smokeBrush(log));
  await step('intake', () => smokeIntake(log));
  await step('capture', () => smokeCapture(log, setHarness, ratio));
  await step('wand', () => smokeWand(log));
  await step('zoom', () => smokeZoomCanvas(log, setHarness));
  // a takarítása bezárja a store projektjét: a felhasználó nyitott munkájához nem nyúlhat
  if (useEditorStore.getState().project) {
    log(null, 'autosave-kör kihagyva', 'nyitott projekt van');
  } else {
    await step('autosave', () => smokeAutosave(log, setHarness));
  }
  if (online) {
    await step('worker', () => smokeWorker(log));
    await step('canvas-ops', () => smokeCanvasOps(log));
    await step('parity', () => smokeParity(log));
  }
}
