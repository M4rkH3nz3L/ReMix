import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { setNativeDenoise, type DenoiseRun } from '@/lib/denoise';
import { setNativeFormant, type FormantRun } from '@/lib/formant';
import { setNativeDsp, type DspRun } from '@/lib/dspKernels';

/**
 * ⚡ A natív DSP-mag bekötése (`RemixRender.dspRun`): a telefonon az előnézet és a telefonos export
 * is ezt használja (azonos kimenet). A régi build (nincs `dspRun`) és a web a JS-változaton marad.
 */
const mod = Platform.OS === 'web' ? null : requireOptionalNativeModule<{ dspRun?: DspRun; denoiseRun?: DenoiseRun; formantRun?: FormantRun }>('RemixRender');
if (mod && typeof mod.dspRun === 'function') {
  const run = mod.dspRun.bind(mod);
  setNativeDsp((kind, l, r, p, st, aux) => run(kind, l, r, p, st, aux));
}
// ⚡ S20: a zajszűrés keretenkénti munkája natívan (bitre = a JS `denoiseRunJs`); régi buildben a JS fut
if (mod && typeof mod.denoiseRun === 'function') {
  const dn = mod.denoiseRun.bind(mod);
  setNativeDenoise((l, r, tabs, state, outL, outR, params) => dn(l, r, tabs, state, outL, outR, params));
}

// ⚡ a formáns-korrekció natívan (bitre = a JS `formantCorrect`); régi buildben a JS fut
if (mod && typeof mod.formantRun === 'function') {
  const fr = mod.formantRun.bind(mod);
  setNativeFormant((ref, shifted, out, tabs, params) => fr(ref, shifted, out, tabs, params));
}

export {};
