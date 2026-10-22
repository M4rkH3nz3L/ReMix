import { Asset } from 'expo-asset';

import {
  canRenderLocally,
  isNativeRenderAvailable,
  renderLocal,
} from '@/lib/nativeRender';
import { createEmptyProject } from '@/lib/projectUtils';
import { isRenderCancelledError, type RenderSettings } from '@/lib/render';
import type { Project, VideoClip } from '@/types/project';

/**
 * 📱 ESZKÖZÖN-RENDER FÜSTTESZT — csak dev-buildben, env-kapcsolóval.
 *
 * `EXPO_PUBLIC_RENDER_SMOKE=1 npx expo run:ios --device …` → az app indulása
 * után automatikusan lefut, és a Metro-konzolra írja az eredményt
 * (`[RENDER-SMOKE] …`). Ember nélkül bizonyítja a natív render-utat egy valódi
 * eszközön: bundlelt minta-videóból két szegmens (vágás + 2× sebesség +
 * hangerő) + vízjel + bitráta-plafon → kész MP4; külön a MEGSZAKÍTÁS
 * (AbortSignal → natív `cancel()`) is tesztelve.
 *
 * A modul a `_layout` __DEV__-ágából, dinamikus importtal töltődik → release
 * bundle-be sem a kód, sem a minta-mp4 nem kerül be.
 */

const TAG = '[RENDER-SMOKE]';

const SETTINGS: RenderSettings = {
  resolution: 720,
  fps: 30,
  quality: 'high',
  codec: 'h264',
  bitrateMode: 'vbr',
  bitrateMbps: 5,
};

function smokeClip(id: string, uri: string, overrides: Partial<VideoClip>): VideoClip {
  return {
    id,
    kind: 'video',
    uri,
    start: 0,
    duration: 1,
    trimIn: 0,
    sourceDuration: 2,
    speed: 1,
    volume: 1,
    filterId: 'none',
    ...overrides,
  };
}

/** A minta-videóból épített mini-projekt: 2 szegmens (az egyik 2×, halkítva). */
function smokeProject(uri: string): Project {
  const project = createEmptyProject('RenderSmoke', '9:16');
  const videoTrack = project.tracks.find((t) => t.type === 'video');
  if (!videoTrack) {
    throw new Error('nincs videó-sáv a smoke-projektben');
  }
  videoTrack.clips.push(
    smokeClip('smoke-a', uri, { start: 0, trimIn: 0, duration: 1, volume: 0.8 }),
    smokeClip('smoke-b', uri, { start: 1, trimIn: 1, duration: 0.5, speed: 2, volume: 0 })
  );
  return project;
}

export async function runRenderSmoke(): Promise<void> {
  console.log(`${TAG} indul…`);
  try {
    if (!isNativeRenderAvailable()) {
      console.log(`${TAG} FAIL: a natív RemixRender modul nem elérhető ebben a buildben`);
      return;
    }

    // minta-videó a bundle-ből a cache-be (dev-ben a Metro szolgálja ki)
    const asset = Asset.fromModule(require('../../assets/videos/render-smoke.mp4'));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri.startsWith('file')) {
      console.log(`${TAG} FAIL: a minta-videó nem helyi fájl (${uri})`);
      return;
    }
    const project = smokeProject(uri);
    if (!canRenderLocally(project, SETTINGS)) {
      console.log(`${TAG} FAIL: canRenderLocally=false a smoke-projektre`);
      return;
    }

    // 1) MEGSZAKÍTÁS: indítás után azonnali abort → RenderCancelledError-t
    //    várunk (determinisztikus: az eszköz gyorsabb lehet bármely időzítőnél)
    const controller = new AbortController();
    const cancelling = renderLocal(project, SETTINGS, undefined, controller.signal, false);
    controller.abort();
    try {
      await cancelling;
      console.log(`${TAG} cancel: nem egyértelmű (a render gyorsabb volt az abortnál)`);
    } catch (err) {
      if (isRenderCancelledError(err)) {
        console.log(`${TAG} cancel PASS: a megszakítás RenderCancelledError-t adott`);
      } else {
        console.log(`${TAG} cancel FAIL: váratlan hiba — ${(err as Error).message}`);
      }
    }

    // 2) TELJES RENDER vízjellel + bitráta-plafonnal (a megszakítás UTÁN — a
    //    session-újraindulást is bizonyítja)
    const t0 = Date.now();
    let lastProgress = 0;
    const file = await renderLocal(
      project,
      SETTINGS,
      (p) => {
        lastProgress = p;
      },
      undefined,
      true // vízjel-ág is fusson
    );
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const size = file.exists ? (file.size ?? 0) : 0;
    if (file.exists && size > 10_000) {
      console.log(
        `${TAG} render PASS: ${file.uri} · ${(size / 1024).toFixed(0)} KB · ${elapsed}s · utolsó progress=${lastProgress.toFixed(2)}`
      );
    } else {
      console.log(`${TAG} render FAIL: hiányzó/üres kimenet (exists=${file.exists}, size=${size})`);
    }
  } catch (err) {
    console.log(`${TAG} FAIL: ${(err as Error).message}`);
  }
}
