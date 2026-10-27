import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, Ref } from 'react';
import type { ViewProps } from 'react-native';

import type { Remix3DNative } from '../../modules/remix-3d';

/**
 * 🧊 A `remix-3d` natív modul JS-oldala (3D-Studio.md §5) — OPCIONÁLIS feloldás:
 * Androidon / Expo Go-ban / weben nincs modul → minden itt `null`, és a LiDAR-kapu
 * (§1.1) miatt a 3D Stúdió el sem érhető. A nézeteket csak akkor oldjuk fel, ha a
 * modul létezik (különben a `requireNativeView` dobna).
 */
export const Remix3D = requireOptionalNativeModule<Remix3DNative>('Remix3D');

export interface CaptureStateEvent {
  state: 'initializing' | 'ready' | 'detecting' | 'capturing' | 'finishing' | 'completed' | 'failed' | 'unknown';
  /** az Apple visszajelzés-kódjai (pl. „objectTooClose", „environmentTooDark") */
  feedback: string[];
}

export interface CaptureViewHandle {
  start(imagesDir: string): Promise<void>;
  command(name: 'detect' | 'capture' | 'newPass' | 'finish' | 'cancel'): Promise<boolean>;
}

export interface MeshScanStateEvent {
  tracking: 'normal' | 'notAvailable' | 'excessiveMotion' | 'insufficientFeatures' | 'initializing' | 'relocalizing' | 'limited';
  triangles: number;
  /** ARKit környezeti fény (lumen-szerű, ~1000 = normál beltér) */
  light: number;
}

export interface MeshScanHandle {
  start(): Promise<void>;
  pause(): Promise<void>;
  exportMesh(outputPath: string): Promise<{
    uri: string;
    triangles: number;
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }>;
}

/** a kész háló megjelenítése: nincs / a felületen / csak a háló */
export type WireframeMode = 'off' | 'overlay' | 'only';

export interface ModelViewHandle {
  snapshot(outputPath: string, width: number, height: number, transparent: boolean): Promise<string>;
}

type CaptureViewProps = ViewProps & {
  ref?: Ref<CaptureViewHandle>;
  onCaptureState?: (e: { nativeEvent: CaptureStateEvent }) => void;
};

type MeshScanViewProps = ViewProps & {
  ref?: Ref<MeshScanHandle>;
  onScanState?: (e: { nativeEvent: MeshScanStateEvent }) => void;
};

type ModelViewProps = ViewProps & {
  ref?: Ref<ModelViewHandle>;
  modelUri?: string;
  wireframe?: WireframeMode;
  background?: string | null;
  autoRotate?: boolean;
  onLoad?: (e: { nativeEvent: { radius: number } }) => void;
  onError?: (e: { nativeEvent: { code: string; message?: string } }) => void;
};

/**
 * Natív nézet biztonságos feloldása: régebbi natív build (amiben az adott nézet még
 * nincs) vagy hiányzó modul esetén `null` — a hívó a funkciót egyszerűen nem kínálja,
 * a képernyő nem omlik össze (a JS a natív buildnél frissebb is lehet: hot reload).
 */
function optionalView<P>(name: string): ComponentType<P> | null {
  if (!Remix3D) {
    return null;
  }
  // a `requireNativeView` hiányzó nézetnél NEM dob, csak figyelmeztet, és a render bukna →
  // előbb a natív nézet-konfigurációt kérdezzük meg (expo-modules-core ugyanígy dönt)
  const expoGlobal = (globalThis as { expo?: { getViewConfig?: (m: string, v?: string) => unknown } }).expo;
  if (!expoGlobal?.getViewConfig?.(name)) {
    return null;
  }
  try {
    return requireNativeView(name) as ComponentType<P>;
  } catch {
    return null;
  }
}

export const Remix3DCaptureView = optionalView<CaptureViewProps>('Remix3DCaptureView');

/** szabad szken élő LiDAR-hálóval (ARKit scene reconstruction) */
export const Remix3DMeshScanView = optionalView<MeshScanViewProps>('Remix3DMeshScanView');

export const Remix3DModelView = optionalView<ModelViewProps>('Remix3DModelView');

/**
 * A natív hiba-üzenet (`unsupported:x` / `badInput:x` / `failed:x` / `cancelled`)
 * → i18n-kulcs (ember-olvasható, nem fejlesztői zsargon — T1/A6 tanulság).
 */
export function remix3dErrorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes('cancelled')) return 'model3d.error.cancelled';
  if (msg.includes('unsupported')) return 'model3d.error.unsupported';
  if (msg.includes('badInput')) return 'model3d.error.badInput';
  return 'model3d.error.failed';
}
