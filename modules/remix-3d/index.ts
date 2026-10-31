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
    usdExport?: boolean;
  }>;
  reconstruct(imagesDir: string, outputPath: string, quality: 'preview' | 'medium' | 'full'): Promise<string>;
  cancelReconstruct(): Promise<boolean>;
  /**
   * 📦 kivitel / tárolási átalakítás (háttérszálon). `optionsJson`: forgatás + formátum, egység,
   * minőség, textúra (`exportOptionsJson`). → a TÉNYLEGES uri (OBJ textúrával → .zip)
   */
  exportModel(inputPath: string, outputPath: string, optionsJson?: string | null): Promise<string>;
  /** ✂️ forgatás beégetése + padló levágása + egyszerűsítés → új fájl a kimenet kiterjesztése szerint (textúra nélküli hálóhoz) */
  processMesh(
    inputPath: string,
    outputPath: string,
    optionsJson: string
  ): Promise<{
    uri: string;
    triangles: number;
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }>;
  snapshotFile(
    modelPath: string,
    outputPath: string,
    width: number,
    height: number,
    yaw: number,
    pitch: number,
    transparent: boolean,
    /** `{"rotation":[x,y,z,w],"preset":"studio","exposure":1}` */
    optionsJson?: string | null
  ): Promise<string>;
  inspectModel(modelPath: string): Promise<{
    triangles: number;
    /** pontfelhőnél a pontszám (saját olvasós formátumoknál) */
    points?: number;
    /** van-e textúrája (az import tárolási döntéséhez) */
    textured?: boolean;
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }>;
  /** 🖼️ teljesen üres-e a kép (pl. régi, háttérben renderelt poszter) */
  imageIsBlank?(path: string): Promise<boolean>;
  /** 🥽 AR Gyorsnézet (Apple AR Quick Look) — USDZ a valós térben, valós méretben */
  presentAR?(usdzPath: string): Promise<boolean>;
  /** 🎬 360°-os forgó felvétel → H.264 MP4 (a készüléken); haladás: `onRenderProgress` */
  renderTurntable(
    modelPath: string,
    outputPath: string,
    width: number,
    height: number,
    seconds: number,
    fps: number,
    pitch: number,
    background: string | null,
    optionsJson?: string | null
  ): Promise<string>;
  cancelRender(): Promise<boolean>;
  addListener(
    event: 'onReconstructProgress' | 'onRenderProgress',
    listener: (e: { progress: number }) => void
  ): { remove: () => void };
}
