import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { planBatchExport } from '@/lib/batchExport';
import { publishRenderedProject } from '@/lib/feed';
import { logCaught } from '@/lib/logCaught';
import { deviceRenderGaps, localRenderBlockers } from '@/lib/nativeRender';
import { isRenderCancelledError, renderAndPost, renderAndShareMp4, settingsNeedCloud } from '@/lib/render';
import type { ExportPlatform, PostTarget, RenderMode, RenderSettings } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import { guardPro, usePaywall } from '@/store/paywallStore';
import { withCancellableProgress, withProgress } from '@/store/progressStore';
import { useSeoGate } from '@/store/seoGateStore';
import { nudgeUpsell } from '@/store/upsellStore';
import type { Project } from '@/types/project';
import type { PostVisibility } from '@/types/social';

export interface VideoExportDeps {
  project: Project;
  t: TFunction;
  renderStatus: string | null;
  setRenderStatus: (status: string | null) => void;
  buildSettings: () => RenderSettings;
  batchSet: ReadonlySet<ExportPlatform>;
  isPro: boolean;
  engine: RenderMode;
}

/**
 * A videó-render műveletei (eszköz / batch / felhő / feed / platform-posztolás) —
 * a panel renderenként hozza létre, az aktuális állapot-pillanatképpel.
 */
export function createVideoExportActions(deps: VideoExportDeps) {
  const { project, t, renderStatus, setRenderStatus, buildSettings, batchSet, isPro, engine } = deps;

  // 🎯 paritás-előkérdés (WYSIWYG): ha az eszköz-motor nem tudná visszaadni,
  // amit a szerkesztő mutat (szöveg/effekt/átmenet…), NEM adunk néma, hiányos
  // videót — a user választ: felhő-render (teljes paritás) vagy mégse.
  const resolveLocalMode = (): Promise<'local' | 'cloud' | null> => {
    // minden ok, ami miatt a telefon nem adná vissza a látottat: paritás-rés, a motor korlátja, felhős kodek
    const gaps: string[] = [
      ...deviceRenderGaps(project),
      ...localRenderBlockers(project, buildSettings()),
      ...(settingsNeedCloud(buildSettings()) ? ['codec'] : []),
    ];
    if (gaps.length === 0) {
      return Promise.resolve('local');
    }
    // 🚪 nincs zsákutca: a lista NÉVEN mondja, mit kell kivenni az ingyenes telefonos exporthoz; a felhő Pro
    // nélkül a Pro-ajánlatot nyitja (nem nyers hibaüzenetet a render indítása után)
    const pro = useEntitlement.getState().isPro();
    const list = gaps.map((g) => `• ${t(`panels.export.gap.${g}`)}`).join('\n');
    return new Promise((resolve) => {
      Alert.alert(
        t('panels.export.parityTitle'),
        t('panels.export.parityMsgList', { list }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
          pro
            ? { text: t('panels.export.parityCloudCta'), onPress: () => resolve('cloud') }
            : {
                text: t('panels.export.parityProCta'),
                onPress: () => {
                  usePaywall.getState().open('cloudRender');
                  resolve(null);
                },
              },
        ],
        { cancelable: false }
      );
    });
  };

  // 📱 Export az ESZKÖZÖN (ingyen, szerver nélkül) — a build natív renderelője
  const exportLocal = async () => {
    if (renderStatus) {
      return; // már fut
    }
    const mode = await resolveLocalMode();
    if (!mode) {
      return;
    }
    setRenderStatus(t('common.processing'));
    // a Pro-hiány (pl. felhő-tartalék) a Pro-ajánlatot nyitja, nem nyers hibát (guardPro)
    void guardPro(
      async () => {
        await withCancellableProgress(t('panels.export.exportOnDevice'), (report, signal) =>
          renderAndShareMp4(project, report, buildSettings(), { mode, signal })
        );
        // 💡 C2.3: a Free export vízjeles → az export UTÁN (nem közben) ajánlat, ha a motor engedi
        void nudgeUpsell('export_watermark', 'export_done');
      },
      (err) => {
        logCaught('components/editor/panels/ExportPanel.tsx:exportLocal', err);
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.exportOnDevice'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  // 📦 Batch-export: a kiválasztott platformok deduplikált jobjai SORBAN (mindegyik a saját
  // aspect + settings beállítással renderel + megoszt). A pure terv: `planBatchExport` (tesztelt).
  const exportBatch = async () => {
    if (renderStatus) {
      return;
    }
    const jobs = planBatchExport([...batchSet], buildSettings());
    if (jobs.length === 0) {
      return;
    }
    // 🎯 paritás-előkérdés a batch-re is (egyszer, az egész sorozatra)
    const mode = await resolveLocalMode();
    if (!mode) {
      return;
    }
    setRenderStatus(t('common.processing'));
    // a Pro-hiány a Pro-ajánlatot nyitja, nem nyers hibát (guardPro)
    await guardPro(
      async () => {
        for (const job of jobs) {
          const jobProject = { ...project, aspectRatio: job.aspect as typeof project.aspectRatio };
          // SORBAN rendereljük (párhuzamosan túlterhelné az eszközt)
          await withCancellableProgress(`${t('panels.export.exportOnDevice')} · ${job.label}`, (report, signal) =>
            renderAndShareMp4(jobProject, report, job.settings, { mode, signal })
          );
        }
      },
      (err) => {
        logCaught('components/editor/panels/ExportPanel.tsx:exportBatch', err);
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.batchTitle', { defaultValue: 'Batch export' }), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  // ☁️ Felhő HD render (Pro) — a fizetős workereken; Pro-hiánynál paywall
  const exportCloud = () => {
    if (renderStatus) {
      return; // már fut
    }
    setRenderStatus(t('common.processing'));
    void guardPro(
      () =>
        withCancellableProgress(t('panels.export.cloudHdRender'), (report, signal) =>
          renderAndShareMp4(project, report, buildSettings(), { mode: 'cloud', signal })
        ),
      (err) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.cloudRenderTitle'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  // 📱 Megosztás a FEEDBE: előbb a LÁTHATÓSÁG (ki láthatja) — TikTok-modell:
  // Nyilvános / Követők / Privát —, majd render (ha kell) → feltöltés → poszt.
  const shareToFeed = () => {
    if (renderStatus) {
      return;
    }
    // 2. lépés: 🔀 az alkotó dönt a remix-engedélyről (B27 — eddig mindig engedélyezett volt)
    const askRemix = (visibility: PostVisibility) =>
      Alert.alert(t('feed.remixAllowTitle'), t('feed.remixAllowPrompt'), [
        { text: t('feed.remixAllowYes'), onPress: () => doShareToFeed(visibility, true) },
        { text: t('feed.remixAllowNo'), onPress: () => doShareToFeed(visibility, false) },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    Alert.alert(t('feed.visibilityTitle'), t('feed.visibilityPrompt'), [
      { text: t('feed.visPublic'), onPress: () => askRemix('public') },
      { text: t('feed.visFollowers'), onPress: () => askRemix('followers') },
      // privát poszt eleve nem remixelhető-látható → nem kérdezünk
      { text: t('feed.visPrivate'), onPress: () => doShareToFeed('private', false) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  // a választott láthatósággal renderel + posztol. A renderelt változat a
  // projekten marad (újramegosztáshoz).
  const doShareToFeed = async (visibility: PostVisibility, remixable = true) => {
    if (renderStatus) {
      return;
    }
    // 📣 S22: a SEO a megosztáskor kell — hiányzik → bekéri, megszakításkor nem posztol
    const seoReady = await useSeoGate.getState().ensureSeo(project);
    if (!seoReady) {
      return;
    }
    const project_ = seoReady;
    setRenderStatus(t('common.processing'));
    void guardPro(
      () =>
        withProgress(t('feed.rendering'), (report) =>
          publishRenderedProject(project_, report, {
            visibility,
            remixable,
            ...(isPro ? { renderMode: engine } : {}),
          }).then((res) => {
            useEditorStore.getState().setRendered(res.project.rendered);
            Alert.alert(t('feed.shareToFeed'), t('feed.sharedOk'), [
              { text: t('common.ok') },
              { text: t('nav.feed'), onPress: () => router.push('/') },
            ]);
          })
        ),
      (err) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('feed.shareToFeed'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  // 📲 Posztolás egy platformra: render → Fotókba mentés → a platform megnyitása.
  // 'auto': ha a build tudja, eszközön renderel (ingyen); különben felhő (Pro).
  const postTo = (target: PostTarget) => {
    if (renderStatus) {
      return;
    }
    setRenderStatus(t('common.processing'));
    void guardPro(
      () =>
        withCancellableProgress(t('panels.export.postTo', { target }), (report, signal) =>
          renderAndPost(project, target, report, buildSettings(), {
            mode: isPro ? engine : 'auto',
            signal,
          })
        ),
      (err) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.postingTitle'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  return { exportLocal, exportBatch, exportCloud, shareToFeed, postTo };
}
