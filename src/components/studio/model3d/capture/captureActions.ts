import type { TFunction } from 'i18next';
import type { RefObject } from 'react';
import { Alert } from 'react-native';

import { captureDirFor } from '@/components/studio/model3d/capture/captureDir';
import type { Phase, SetState } from '@/components/studio/model3d/studioTypes';
import { haptics } from '@/design';
import { logCaught } from '@/lib/logCaught';
import {
  remix3dErrorKey,
  type CaptureStateEvent,
  type CaptureViewHandle,
  type MeshScanHandle,
  type MeshScanStateEvent,
  type RoomScanHandle,
} from '@/lib/remix3dNative';
import type { Asset } from '@/types/project';

export interface CaptureActionDeps {
  t: TFunction;
  projectId: string;
  asset: Asset | undefined;
  capState: CaptureStateEvent;
  captureRef: RefObject<CaptureViewHandle | null>;
  meshRef: RefObject<MeshScanHandle | null>;
  roomRef: RefObject<RoomScanHandle | null>;
  scanStartedAt: { current: string };
  setPhase: SetState<Phase>;
  setPicking: SetState<boolean>;
  setScanMode: SetState<'mesh' | 'points'>;
  setScanState: SetState<MeshScanStateEvent>;
  setCapState: SetState<CaptureStateEvent>;
  /** a kész képkészlet → rekonstrukció (processing/) */
  reconstruct: () => Promise<void>;
}

/**
 * 🎯 A rögzítés hook nélküli akciói (REFACTOR: a Model3DStudio.tsx-ből): a szken-módok
 * indítása / megszakítása és az objektum-rögzítés vezérlése a natív nézeteken át.
 */
export function createCaptureActions(d: CaptureActionDeps) {
  const { t, projectId, asset, capState, captureRef, meshRef, roomRef, scanStartedAt, setPhase, setPicking, setScanMode, setScanState, setCapState, reconstruct } = d;

  const discardCapture = () => {
    void captureRef.current?.command('cancel').catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:discardCapture', caught); });
    try {
      captureDirFor(projectId).delete();
    } catch (caught) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:discardCapture', caught);
      // nincs mit törölni
    }
    setPhase(asset ? 'viewer' : 'empty');
  };

  const confirmCancel = () =>
    Alert.alert(t('model3d.capture.cancelTitle'), t('model3d.capture.cancelBody'), [
      { text: t('model3d.capture.keep'), style: 'cancel' },
      { text: t('model3d.capture.discard'), style: 'destructive', onPress: discardCapture },
    ]);

  // ── 🕸️ szabad szken: élő LiDAR-háló a kameraképen ─────────────────────────
  const startMeshScan = (mode: 'mesh' | 'points') => {
    setPicking(false);
    setScanMode(mode);
    scanStartedAt.current = new Date().toISOString();
    setScanState({ tracking: 'initializing', triangles: 0, light: 1000, points: 0 });
    setPhase('meshScanning');
    requestAnimationFrame(() => {
      void meshRef.current?.start(mode).catch((e) => { logCaught('components/studio/model3d/Model3DStudio.tsx:startMeshScan', e); return Alert.alert(t('model3d.title'), t(remix3dErrorKey(e))); });
    });
  };

  /** a hálós szken bezárása (a szkenner szünetel, vissza a nézőbe / módválasztóba) */
  const cancelMeshScan = () => {
    void meshRef.current?.pause();
    setPhase(asset ? 'viewer' : 'empty');
  };

  // ── 🏠 szoba-szken (RoomPlan): falak, nyílások, bútorok élőben ─────────────
  const startRoomScan = () => {
    setPicking(false);
    scanStartedAt.current = new Date().toISOString();
    setPhase('roomScanning');
    requestAnimationFrame(() => {
      void roomRef.current?.start().catch((e) => {
        logCaught('components/studio/model3d/Model3DStudio.tsx:startRoomScan', e);
        Alert.alert(t('model3d.title'), t(remix3dErrorKey(e)));
        setPhase(asset ? 'viewer' : 'empty');
      });
    });
  };

  const cancelRoomScan = () => {
    void roomRef.current?.cancel();
    setPhase(asset ? 'viewer' : 'empty');
  };

  const startCapture = () => {
    setPicking(false);
    const dir = captureDirFor(projectId);
    try {
      dir.delete();
    } catch (caught) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:startCapture', caught);
      // friss könyvtár
    }
    setCapState({ state: 'initializing', feedback: [] });
    setPhase('capturing');
    // a natív nézet a következő frame-ben mountol → utána indítjuk a munkamenetet
    requestAnimationFrame(() => {
      void captureRef.current?.start(dir.uri).catch((e) => { logCaught('components/studio/model3d/Model3DStudio.tsx:startCapture', e); return Alert.alert(t('model3d.title'), t(remix3dErrorKey(e))); });
    });
  };

  const onCaptureState = (e: CaptureStateEvent) => {
    setCapState(e);
    if (e.state === 'completed') {
      void reconstruct();
    }
  };

  const primaryAction = () => {
    haptics.selection();
    const c = captureRef.current;
    if (!c) return;
    if (capState.state === 'ready') void c.command('detect');
    else if (capState.state === 'detecting') void c.command('capture');
    else if (capState.state === 'capturing') void c.command('finish');
  };

  return { discardCapture, confirmCancel, startMeshScan, cancelMeshScan, startRoomScan, cancelRoomScan, startCapture, onCaptureState, primaryAction };
}
