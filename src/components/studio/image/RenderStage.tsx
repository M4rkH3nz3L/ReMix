import { Directory, File, Paths } from 'expo-file-system';
import { SaveFormat, ImageManipulator } from 'expo-image-manipulator';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { StageLayers } from '@/components/studio/image/StageLayers';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { textClipBases, textMaskSubDoc } from '@/lib/imageClip';
import { stageSettleMs, stageSize } from '@/lib/imageRenderRoute';
import { logCaught } from '@/lib/logCaught';
import { loadProjectFonts } from '@/lib/projectFontsClient';
import { useEditorStore } from '@/store/editorStore';
import { setTextMaskEnsurer, useTextMasks } from '@/store/textMaskStore';
import { registerRenderStage, renderOnDevice, type RenderStageHandle, type RenderStageOptions } from '@/lib/renderStageRegistry';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { ImageDoc } from '@/types/project';

/**
 * 🖨️ RENDER-SZÍNPAD (CORE K1 · IMAGE-PROD C1): a kép-dokumentum raszterizálása a TELEFONON,
 * szerver nélkül, bármely lapra (nem csak az aktívra), a kért pixelméreten.
 *
 * Ugyanazt a réteg-fát rajzolja, mint a vászon (`CanvasLayerView`, vignetta, szemcse) —
 * ezt a fát méri a füstteszt a szerver-renderrel paritásban —, csak kijelölés-króm, gesztus
 * és nagyítás nélkül, egy rejtett, doc-felbontású nézetben (a natív kép = a kért pixelek).
 * A munkák sorban futnak; a színpad csak a munka idejére él.
 */

export type { RenderStageHandle, RenderStageOptions };
export { StageLayers };
export { renderOnDevice };

/** ha a színpad ennyi idő alatt sem rajzolódik ki (nincs felcsatolva), feladjuk */
const MOUNT_TIMEOUT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A telefonos render ideiglenes fájlt ad; ami a projektben marad (réteg, bélyegkép), az a
 * projekt média-mappájába kerül. A már ott lévő (pl. worker-) fájlt nem mozgatja.
 */
export function keepRenderedInProject(uri: string, base: string): string {
  const dir = projectMediaDir();
  if (uri.startsWith(dir.uri)) {
    return uri;
  }
  if (!dir.exists) {
    dir.create();
  }
  const source = new File(uri);
  const target = new File(dir, `${base}.${uri.split('.').pop() || 'png'}`);
  if (target.exists) {
    target.delete();
  }
  source.move(target);
  // a cél útvonala a mérvadó (a forrás-objektum uri-ja platformonként másként frissül)
  return target.uri;
}

/** a folyamatban lévő maszk-renderek (ugyanazt a kulcsot csak egyszer) */
const maskInFlight = new Map<string, Promise<void>>();

/**
 * ✂️🔤 S18: a szöveg-alapú vágások hiányzó maszk-képei a telefonon (a regisztrált színpadon, a sorában —
 * ezért a fő render ELŐTT kell hívni, nem belőle). A kész maszk a `useTextMasks` tárba kerül.
 */
export async function ensureTextClipMasks(doc: ImageDoc): Promise<void> {
  const canvas = effectiveCanvas(doc);
  const height = Math.min(2048, Math.round(canvas.height));
  for (const { key, text } of textClipBases(doc)) {
    const have = useTextMasks.getState().map.get(key);
    if (have && new File(have).exists) continue;
    let job = maskInFlight.get(key);
    if (!job) {
      job = renderOnDevice(textMaskSubDoc(doc, text), height, { format: 'png' })
        .then((uri) => {
          if (!uri) return;
          // a rögzítés séma nélküli ideiglenes útvonalat adhat — a Skia-betöltőnek rendes `file://` kell, és
          // a cache-mappában kulcs szerint egy helyen él (az OS takaríthatja; akkor újra elkészül)
          const dir = new Directory(Paths.cache, 'textmasks');
          if (!dir.exists) dir.create({ intermediates: true });
          const target = new File(dir, `${key}.png`);
          if (target.exists) target.delete();
          new File(uri.startsWith('file://') ? uri : `file://${uri}`).copy(target);
          useTextMasks.getState().put(key, target.uri);
        })
        .catch((caught) => logCaught('components/studio/image/RenderStage.tsx:textMask', caught))
        .finally(() => maskInFlight.delete(key));
      maskInFlight.set(key, job);
    }
    await job;
  }
}

setTextMaskEnsurer(ensureTextClipMasks);

export const RenderStage = forwardRef<RenderStageHandle>(function RenderStage(_props, ref) {
  const [job, setJob] = useState<{ doc: ImageDoc; w: number; h: number; seq: number } | null>(null);
  const viewRef = useRef<View>(null);
  const onMounted = useRef<(() => void) | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef(0);

  const handle = useRef<RenderStageHandle>({
    async render(doc, heightPx, opts = {}) {
      // ✂️🔤 a szöveg-vágások maszkjai ELŐBB (külön feladatként a sorban — egy futó renderből nem lehet)
      if (textClipBases(doc).length > 0) {
        await ensureTextClipMasks(doc);
      }
      const run = async (): Promise<string | null> => {
        // 🔤 S10: a projekt saját fontjai betöltve (különben a rendszer-fonttal rajzolna)
        await loadProjectFonts(useEditorStore.getState().project?.fonts);
        const size = stageSize(effectiveCanvas(doc), heightPx, PixelRatio.get());
        const mounted = new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), MOUNT_TIMEOUT_MS);
          onMounted.current = () => {
            clearTimeout(timer);
            resolve(true);
          };
        });
        seq.current += 1;
        setJob({ doc, w: size.w, h: size.h, seq: seq.current });
        try {
          if (!(await mounted)) {
            logCaught('components/studio/image/RenderStage.tsx:mount', new Error('a render-színpad nem csatolódott fel'));
            return null;
          }
          await sleep(stageSettleMs(doc));
          const png = await captureRef(viewRef, {
            format: opts.format === 'jpg' ? 'jpg' : 'png',
            quality: opts.quality ?? 1,
            // a rajz legalább `STAGE_MIN_LONG_PT` méretű; a rögzítés a kért pixelekre kicsinyít
            width: size.capW,
            height: size.capH,
          });
          if (opts.format !== 'webp') {
            return png;
          }
          // a view-shot WebP-t nem ír: a PNG átkódolva, az alfa megmarad
          const rendered = await ImageManipulator.manipulate(png).renderAsync();
          const out = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: opts.quality ?? 1 });
          return out.uri;
        } catch (caught) {
          logCaught('components/studio/image/RenderStage.tsx:render', caught);
          return null;
        } finally {
          onMounted.current = null;
          setJob(null);
        }
      };
      // a `run` nem dob (a hibát naplózza és `null`-t ad), így a sor nem akad el
      const result = queue.current.then(run, run);
      queue.current = result;
      return result;
    },
  }).current;
  useImperativeHandle(ref, () => handle, [handle]);
  useEffect(() => registerRenderStage(handle), [handle]);

  if (!job) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.host}>
      <View
        key={job.seq}
        ref={viewRef}
        collapsable={false}
        style={[styles.stage, { width: job.w, height: job.h }]}
        onLayout={() => onMounted.current?.()}
      >
        <StageLayers doc={job.doc} w={job.w} h={job.h} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // a képernyőn KÍVÜL: az áttetsző fejléc / állapotsor alatt sem látszik (eszközön látott hiba:
  // a bal felső sarokban áttűnt); a rögzítés a nézet saját rétegéből dolgozik, így ide is ér
  host: { position: 'absolute', left: -100000, top: 0 },
  stage: { overflow: 'hidden', backgroundColor: 'transparent' },
});
