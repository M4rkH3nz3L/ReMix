// A `remix-render` LOKÁLIS Expo-modul JS-belépője.
//
// Az appban NEM ezt importáljuk közvetlenül — a `src/lib/nativeRender.ts` a
// `requireOptionalNativeModule('RemixRender')`-rel oldja fel futásidőben (így
// Expo Go-ban `null`, natív buildben az igazi modul). Ez a fájl csak a modul
// önálló használatához / típusához van, és sosem dob (opcionális feloldás).
import { requireOptionalNativeModule } from 'expo';

export interface RemixRenderNative {
  /** A render-tervet (JSON) MP4-re rendereli; a kimeneti fájl URI-ját adja vissza. */
  exportPlan(planJson: string, outputPath: string): Promise<string>;
  addListener(
    event: 'onProgress',
    listener: (e: { progress: number }) => void
  ): { remove: () => void };
}

export default requireOptionalNativeModule<RemixRenderNative>('RemixRender');
