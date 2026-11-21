import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';

import { CameraBottomBar, CameraTopBar } from '@/components/editor/cameraRecorder/CameraControls';
import {
  CameraPermissionPrompt,
  FilterGridOverlay,
  RecordingIndicators,
} from '@/components/editor/cameraRecorder/CameraOverlays';
import { styles } from '@/components/editor/cameraRecorder/cameraRecorderStyles';
import { saveRecordingToProject } from '@/components/editor/cameraRecorder/saveRecording';
import { filters } from '@/constants/editor';
import { countdownLeft, MAX_SEC } from '@/lib/cameraRecorderOps';
import type { FilterId } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * In-app kamera-felvétel (short-video belépő) — TikTok-szerű, kreatív:
 * élő szűrő-előnézet (a vibe már felvétel közben látszik ÉS a klipbe ég),
 * sebesség-preset (a klip speed-jét állítja), harmadoló rács, elöl/hátsó
 * kamera, torch, visszaszámláló, felvételi idő + 60 mp auto-stop. A felvett
 * klip natívan iOS-kompatibilis H.264/AAC mp4-ként a videósáv végére kerül,
 * a választott szűrővel és sebességgel.
 * A gyökér tartja az engedélyeket, az időzítőket és a felvétel életciklusát (natív
 * hívások); a mentés és a vezérlők a cameraRecorder/ alatt (REFACTOR).
 */
export function CameraRecorder({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [torch, setTorch] = useState(false);
  const [grid, setGrid] = useState(false);
  const [filterId, setFilterId] = useState<FilterId>('none');
  const [speed, setSpeed] = useState<number>(1);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // engedélyek kérése a felvevő megnyitásakor
  useEffect(() => {
    if (visible) {
      if (!camPerm?.granted) {
        requestCam();
      }
      if (!micPerm?.granted) {
        requestMic();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- csak a felvevő megnyitásakor kérünk engedélyt; az engedély-állapot változása nem indíthat új kérést
  }, [visible]);

  /** ⏱️ a 3-2-1 visszaszámláló — külön ref, hogy bezáráskor törölhető legyen */
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  // ⚠️ a visszaszámlálót IS törölni kell: enélkül a modal bezárása (vagy a
  // komponens lebontása) után is lefutott, és elindította a felvételt egy már
  // eltűnt UI mögött
  useEffect(
    () => () => {
      clearTimer();
      clearCountdown();
    },
    []
  );

  // a modal bezárásakor (a nyitott állapot CLEANUP-jában) a folyamatban lévő
  // visszaszámlálás megszakad — így nem indul felvétel a már eltűnt UI mögött
  useEffect(() => {
    if (!visible) {
      return;
    }
    return () => {
      clearCountdown();
      setCountdown(0);
    };
  }, [visible]);

  // a mentés a cameraRecorder/saveRecording.ts-ben; a sebesség és a szűrő e render closure-jéből
  const saveAndAdd = (uri: string, recorded: number) => saveRecordingToProject(uri, recorded, speed, filterId);

  const beginRecording = async () => {
    if (recording || !cameraRef.current) {
      return;
    }
    setRecording(true);
    elapsedRef.current = 0;
    setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      elapsedRef.current = s;
      setElapsed(s);
      if (s >= MAX_SEC) {
        cameraRef.current?.stopRecording();
      }
    }, 200);
    try {
      const res = await cameraRef.current.recordAsync({ maxDuration: MAX_SEC });
      clearTimer();
      setRecording(false);
      if (res?.uri) {
        await saveAndAdd(res.uri, elapsedRef.current);
        onClose();
      }
    } catch (caught) {
      logCaught('components/editor/CameraRecorder.tsx:beginRecording', caught);
      clearTimer();
      setRecording(false);
    }
  };

  // 3 mp visszaszámláló, majd felvétel
  const startWithCountdown = () => {
    if (recording || countdown > 0) {
      return;
    }
    setCountdown(3);
    const t0 = Date.now();
    clearCountdown(); // biztos, ami biztos: ne fusson kettő
    countdownRef.current = setInterval(() => {
      const left = countdownLeft(t0, Date.now());
      if (left <= 0) {
        clearCountdown();
        setCountdown(0);
        beginRecording();
      } else {
        setCountdown(left);
      }
    }, 200);
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  const granted = camPerm?.granted && micPerm?.granted;
  const filter = filters.find((f) => f.id === filterId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        {granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode="video"
            enableTorch={torch}
          />
        ) : (
          <CameraPermissionPrompt t={t} requestCam={requestCam} requestMic={requestMic} />
        )}

        <FilterGridOverlay filter={filter} grid={grid} />

        {/* felső sáv: bezárás + rács + torch + flip */}
        <CameraTopBar
          onClose={onClose}
          grid={grid}
          setGrid={setGrid}
          torch={torch}
          setTorch={setTorch}
          facing={facing}
          setFacing={setFacing}
        />

        {/* felvételi idő / visszaszámláló */}
        <RecordingIndicators recording={recording} elapsed={elapsed} countdown={countdown} />

        {/* alsó kreatív vezérlők + felvevő-gomb */}
        {granted ? (
          <CameraBottomBar
            t={t}
            speed={speed}
            setSpeed={setSpeed}
            filterId={filterId}
            setFilterId={setFilterId}
            recording={recording}
            stopRecording={stopRecording}
            startWithCountdown={startWithCountdown}
          />
        ) : null}
      </View>
    </Modal>
  );
}
