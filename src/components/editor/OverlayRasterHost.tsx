import { makeImageFromView } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { TextOverlay } from '@/components/preview/TextOverlay';
import {
  registerOverlayRasterHost,
  type OverlayRasterRequest,
} from '@/lib/overlayRasterBridge';
import type { TextClip } from '@/types/project';

/**
 * 📸 Overlay-raszter host: a szöveg/felirat-klipeket a TÉNYLEGES preview-
 * komponenssel (TextOverlay) rendereli egy képernyőn kívüli, kimeneti méretű
 * vásznon, és Skia `makeImageFromView`-val PNG-be fotózza — így az eszközön-
 * render szövege PIXEL-HŰ a szerkesztőhöz (stílus-presetek, kiemelés, 3D-dőlés,
 * gradiens: mind ugyanazon a kódúton). A belépő animációt nem a kép hordozza
 * (a natív motor játssza újra) — a capture a NYUGALMI állapotot fotózza.
 */

/** nyugalmi mintavételi idő: minden zárt képletű görbe 1/0-ban áll itt
 *  (belépők lefutottak; sin(3π·2)=0 és sin(14π·2)=0 → pulse/shake alaphelyzet) */
const STATIC_T = 2;

interface ActiveJob {
  req: OverlayRasterRequest;
  resolve: (m: Map<string, string>) => void;
  reject: (e: Error) => void;
}

function overlaysDir(): Directory {
  const dir = new Directory(Paths.cache, 'overlays');
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

/** két frame-nyi várakozás, hogy a mount utáni layout/paint biztosan kész legyen */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function OverlayRasterHost() {
  const [job, setJob] = useState<ActiveJob | null>(null);
  const [current, setCurrent] = useState<TextClip | null>(null);
  const viewRef = useRef<View>(null);
  const busy = useRef(false);

  useEffect(() => {
    return registerOverlayRasterHost((req) => {
      return new Promise((resolve, reject) => {
        setJob({ req, resolve, reject });
      });
    });
  }, []);

  // a job feldolgozása: klipenként mount → paint → snapshot → PNG-fájl
  useEffect(() => {
    if (!job || busy.current) {
      return;
    }
    busy.current = true;
    const run = async () => {
      const out = new Map<string, string>();
      const { project, clipIds } = job.req;
      const clips: TextClip[] = [];
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          if (clip.kind === 'text' && clipIds.includes(clip.id)) {
            clips.push(clip);
          }
        }
      }
      const dir = overlaysDir();
      for (const clip of clips) {
        setCurrent(clip);
        await afterPaint();
        const image = await makeImageFromView(viewRef);
        if (!image) {
          continue; // ez a klip kimarad — a hívó paritás-kapuja dönt a felhőről
        }
        const bytes = image.encodeToBytes(); // alap: PNG
        const file = new File(dir, `${clip.id}_${project.updatedAt.replace(/[:.]/g, '')}.png`);
        if (file.exists) {
          file.delete();
        }
        file.create();
        file.write(bytes);
        out.set(clip.id, file.uri);
      }
      setCurrent(null);
      job.resolve(out);
    };
    run()
      .catch((e: unknown) => job.reject(e instanceof Error ? e : new Error(String(e))))
      .finally(() => {
        busy.current = false;
        setJob(null);
      });
  }, [job]);

  if (!job || !current) {
    return null;
  }
  const { width, height } = job.req;
  return (
    <View
      ref={viewRef}
      collapsable={false}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -10_000, // képernyőn kívül, de a hierarchiában (a snapshot így is fest)
        top: 0,
        width,
        height,
        backgroundColor: 'transparent',
      }}
    >
      <TextOverlay clip={current} t={STATIC_T} box={{ w: width, h: height }} editable={false} selected={false} />
    </View>
  );
}
