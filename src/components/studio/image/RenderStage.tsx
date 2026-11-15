import { File } from 'expo-file-system';
import { SaveFormat, ImageManipulator } from 'expo-image-manipulator';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { CanvasLayerView } from '@/components/studio/image/CanvasLayerView';
import { DocGrain, DocVignette } from '@/components/studio/image/DocVignette';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { effectiveLayerOpacity, visibleLayers } from '@/lib/imageDoc';
import { correctionContext, docVignetteAngles, NO_CORRECTIONS } from '@/lib/imagePixelPipeline';
import { stageSettleMs, stageSize } from '@/lib/imageRenderRoute';
import { logCaught } from '@/lib/logCaught';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { ClipMask, ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🖨️ RENDER-SZÍNPAD (CORE K1 · IMAGE-PROD C1): a kép-dokumentum raszterizálása a TELEFONON,
 * szerver nélkül, bármely lapra (nem csak az aktívra), a kért pixelméreten.
 *
 * Ugyanazt a réteg-fát rajzolja, mint a vászon (`CanvasLayerView`, vignetta, szemcse) —
 * ezt a fát méri a füstteszt a szerver-renderrel paritásban —, csak kijelölés-króm, gesztus
 * és nagyítás nélkül, egy rejtett, doc-felbontású nézetben (a natív kép = a kért pixelek).
 * A munkák sorban futnak; a színpad csak a munka idejére él.
 */

export interface RenderStageOptions {
  format?: 'png' | 'jpg' | 'webp';
  quality?: number;
}

export interface RenderStageHandle {
  /** a dokumentum képe `heightPx` magasan; `null`, ha nem sikerült (a hiba naplózva) */
  render(doc: ImageDoc, heightPx: number, opts?: RenderStageOptions): Promise<string | null>;
}

const noop = () => {};
const MOVE_RANGE: [number, number] = [0, 1];
/** ha a színpad ennyi idő alatt sem rajzolódik ki (nincs felcsatolva), feladjuk */
const MOUNT_TIMEOUT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function StageLayers({ doc, w, h }: { doc: ImageDoc; w: number; h: number }) {
  const box = useMemo(() => ({ w, h }), [w, h]);
  const { width, height } = effectiveCanvas(doc);
  const canvas = useMemo(() => ({ width, height }), [width, height]);
  const corrections = useMemo(() => correctionContext<ClipMask>(doc), [doc]);
  return (
    <>
      {visibleLayers(doc).map((raw0) => {
        // 🗂️ csoport-opacity a réteg saját opacity-jére szorozva (mint a vásznon)
        const raw =
          raw0.groupId && doc.groups?.some((g) => g.id === raw0.groupId && (g.opacity ?? 1) < 1)
            ? ({ ...raw0, opacity: effectiveLayerOpacity(doc, raw0) } as ImageLayer)
            : raw0;
        return (
          <CanvasLayerView
            key={raw.id}
            layer={raw}
            box={box}
            canvas={canvas}
            zoom={1}
            moveRange={MOVE_RANGE}
            selected={false}
            corrections={corrections.get(raw.id) ?? NO_CORRECTIONS}
            onSelect={noop}
            onMove={noop}
          />
        );
      })}
      <DocVignette angles={docVignetteAngles(doc as Parameters<typeof docVignetteAngles>[0])} box={box} />
      <DocGrain grain={doc.grain ?? 0} cell={w / (doc.width || w)} />
    </>
  );
}

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

/**
 * A felcsatolt színpadok (a legutóbbi az aktív): így a stúdión kívülről (pl. a videó-szerkesztő
 * „Frissítés elérhető” sávjából) is a telefonon renderelhető egy kép-dokumentum.
 */
const mounted: RenderStageHandle[] = [];

/** a dokumentum képe a telefonon; `null`, ha nincs felcsatolt színpad vagy nem sikerült */
export function renderOnDevice(doc: ImageDoc, heightPx: number, opts?: RenderStageOptions): Promise<string | null> {
  const stage = mounted[mounted.length - 1];
  return stage ? stage.render(doc, heightPx, opts) : Promise.resolve(null);
}

export const RenderStage = forwardRef<RenderStageHandle>(function RenderStage(_props, ref) {
  const [job, setJob] = useState<{ doc: ImageDoc; w: number; h: number; seq: number } | null>(null);
  const viewRef = useRef<View>(null);
  const onMounted = useRef<(() => void) | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef(0);

  const handle = useRef<RenderStageHandle>({
    render(doc, heightPx, opts = {}) {
      const run = async (): Promise<string | null> => {
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
            width: size.w,
            height: size.h,
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
  useEffect(() => {
    mounted.push(handle);
    return () => {
      const i = mounted.lastIndexOf(handle);
      if (i >= 0) mounted.splice(i, 1);
    };
  }, [handle]);

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
  // a stúdió többi része eltakarja (a gyökér első gyereke): a felhasználó nem látja
  host: { position: 'absolute', left: 0, top: 0 },
  stage: { overflow: 'hidden', backgroundColor: 'transparent' },
});
