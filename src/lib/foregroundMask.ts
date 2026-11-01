import { requireOptionalNativeModule } from 'expo';

import { logCaught } from '@/lib/logCaught';

interface ForegroundNative {
  /** A téma maszkja szürke PNG-ként (fehér = téma), a kép saját arányában. */
  foregroundMask(uri: string, outputPath: string): Promise<string>;
}

export type ForegroundResult =
  | { status: 'ok'; uri: string }
  /** az eszközön nincs ilyen képesség (iOS 17 alatt, Android, régi build) */
  | { status: 'unsupported' }
  | { status: 'no-subject' }
  | { status: 'failed' };

/**
 * ✂️ A téma kiemelése az eszközön (Apple Vision): ingyenes, a kép nem hagyja el a telefont.
 * A natív modul hiánya nem hiba: ilyenkor a hívó a felhő-útra vált.
 */
export async function foregroundMask(uri: string, outputPath: string): Promise<ForegroundResult> {
  const native = requireOptionalNativeModule<ForegroundNative>('RemixRender');
  if (!native?.foregroundMask) {
    return { status: 'unsupported' };
  }
  try {
    return { status: 'ok', uri: await native.foregroundMask(uri, outputPath) };
  } catch (caught) {
    const message = String((caught as Error)?.message ?? caught);
    if (message.includes('UNSUPPORTED')) {
      return { status: 'unsupported' };
    }
    if (message.includes('NO_SUBJECT')) {
      return { status: 'no-subject' };
    }
    logCaught('lib/foregroundMask.ts', caught);
    return { status: 'failed' };
  }
}
