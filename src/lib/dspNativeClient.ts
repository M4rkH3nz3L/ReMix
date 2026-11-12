import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { setNativeDsp, type DspRun } from '@/lib/dspKernels';

/**
 * ⚡ A natív DSP-mag bekötése (`RemixRender.dspRun`): a telefonon az előnézet és a telefonos export
 * is ezt használja (azonos kimenet). A régi build (nincs `dspRun`) és a web a JS-változaton marad.
 */
const mod = Platform.OS === 'web' ? null : requireOptionalNativeModule<{ dspRun?: DspRun }>('RemixRender');
if (mod && typeof mod.dspRun === 'function') {
  const run = mod.dspRun.bind(mod);
  setNativeDsp((kind, l, r, p, st, aux) => run(kind, l, r, p, st, aux));
}

export {};
