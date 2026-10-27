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

export interface ModelViewHandle {
  snapshot(outputPath: string, width: number, height: number, transparent: boolean): Promise<string>;
}

type CaptureViewProps = ViewProps & {
  ref?: Ref<CaptureViewHandle>;
  onCaptureState?: (e: { nativeEvent: CaptureStateEvent }) => void;
};

type ModelViewProps = ViewProps & {
  ref?: Ref<ModelViewHandle>;
  modelUri?: string;
  background?: string | null;
  autoRotate?: boolean;
  onLoad?: (e: { nativeEvent: { radius: number } }) => void;
  onError?: (e: { nativeEvent: { code: string; message?: string } }) => void;
};

export const Remix3DCaptureView: ComponentType<CaptureViewProps> | null = Remix3D
  ? (requireNativeView('Remix3DCaptureView') as ComponentType<CaptureViewProps>)
  : null;

export const Remix3DModelView: ComponentType<ModelViewProps> | null = Remix3D
  ? (requireNativeView('Remix3DModelView') as ComponentType<ModelViewProps>)
  : null;

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
