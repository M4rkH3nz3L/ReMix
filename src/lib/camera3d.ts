import type { ClipKeyframes, Tilt3D } from '@/types/project';

/**
 * 🎥 Kamera-presetek (🧊 3D V1): egy-koppintásos „virtuális kameramozgások"
 * XYZ-értékek nélkül — a meglévő kulcskocka-motorra (scale/x/y) + térbeli
 * döntésre (tilt3d) fordulnak, így az előnézet és a render változtatás nélkül
 * viszi, és a Pontos igazítás panelen tovább finomíthatók. Pure, tesztelhető.
 */

export type CameraPreset = 'pushIn' | 'pushOut' | 'dramaticZoom' | 'orbit' | 'hero';

export const CAMERA_PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'pushIn', label: 'lib.cameraPreset.pushIn' },
  { id: 'pushOut', label: 'lib.cameraPreset.pushOut' },
  { id: 'dramaticZoom', label: 'lib.cameraPreset.dramaticZoom' },
  { id: 'orbit', label: 'lib.cameraPreset.orbit' },
  { id: 'hero', label: 'lib.cameraPreset.hero' },
];

export interface CameraMove {
  keyframes: ClipKeyframes;
  /** a preset térbeli döntése (hiányzó = a klip döntése törlődik) */
  tilt3d?: Tilt3D;
}

/** preset → kulcskockák + döntés a klip hosszára (mp) */
export function buildCameraMove(preset: CameraPreset, duration: number): CameraMove {
  const d = Math.max(0.5, duration);
  switch (preset) {
    case 'pushIn':
      // lassú dolly előre — a néző „belép" a képbe
      return {
        keyframes: {
          scale: [
            { time: 0, value: 1, easing: 'easeInOut' },
            { time: d, value: 1.28, easing: 'easeInOut' },
          ],
        },
      };
    case 'pushOut':
      // dolly hátra — táguló tér, leleplezés
      return {
        keyframes: {
          scale: [
            { time: 0, value: 1.28, easing: 'easeOut' },
            { time: d, value: 1, easing: 'easeOut' },
          ],
        },
      };
    case 'dramaticZoom':
      // sokáig visszafogott, az utolsó szakaszban berántó zoom (hook-pont)
      return {
        keyframes: {
          scale: [
            { time: 0, value: 1, easing: 'easeIn' },
            { time: d * 0.7, value: 1.12, easing: 'easeIn' },
            { time: d, value: 1.65, easing: 'easeIn' },
          ],
        },
      };
    case 'orbit':
      // oldalra döntött sík + átúszó pan — mintha a kamera körbe fordulna
      return {
        tilt3d: { rotX: 0, rotY: 14 },
        keyframes: {
          scale: [{ time: 0, value: 1.22, easing: 'linear' }],
          x: [
            { time: 0, value: -0.05, easing: 'easeInOut' },
            { time: d, value: 0.05, easing: 'easeInOut' },
          ],
        },
      };
    case 'hero':
      // alulról felnéző „hős-beállás": hátradöntés + lassú push
      return {
        tilt3d: { rotX: 10, rotY: -8 },
        keyframes: {
          scale: [
            { time: 0, value: 1.06, easing: 'easeInOut' },
            { time: d, value: 1.3, easing: 'easeInOut' },
          ],
        },
      };
  }
}
