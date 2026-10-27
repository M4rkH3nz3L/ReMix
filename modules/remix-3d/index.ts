// A `remix-3d` LOKÁLIS Expo-modul típus-belépője (3D-Studio.md §5).
//
// Az app NEM ezt importálja közvetlenül — a `src/lib/remix3dNative.ts` oldja fel
// opcionálisan (Androidon / Expo Go-ban nincs modul → a 3D Stúdió rejtve, §1.1).
export interface Remix3DNative {
  capabilities(): Promise<{
    hasLiDAR: boolean;
    supportsSceneReconstruction: boolean;
    supportsObjectCapture: boolean;
    supportsRoomPlan: boolean;
  }>;
  reconstruct(imagesDir: string, outputPath: string, quality: 'preview' | 'medium' | 'full'): Promise<string>;
  cancelReconstruct(): Promise<boolean>;
  exportModel(inputPath: string, outputPath: string): Promise<string>;
  snapshotFile(
    modelPath: string,
    outputPath: string,
    width: number,
    height: number,
    yaw: number,
    pitch: number,
    transparent: boolean
  ): Promise<string>;
  inspectModel(modelPath: string): Promise<{
    triangles: number;
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }>;
  addListener(event: 'onReconstructProgress', listener: (e: { progress: number }) => void): { remove: () => void };
}
