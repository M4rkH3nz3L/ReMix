import { stillVersion } from '@/lib/linkedAsset';
import type { AspectRatio, ImageDoc, ImageLayer, Project, RenderedVersion, VideoClip } from '@/types/project';

/**
 * 🖼️ Szerkeszthető videó-thumbnail (CORE K5 · IMAGE-PROD C3 · PRO-DESIGN DS6) — pure mag.
 *
 * A thumbnail eddig egy szerveren ráégetett, lapos JPG volt: a cím utólag nem volt javítható, és
 * felhő nélkül nem készült el. Most a videó-projekt egyik kép-dokumentuma (`imageDocs`,
 * `thumbnailDocId`): képkocka-réteg + cím-szöveg, a Kép Stúdióban ugyanazon a projekten és
 * visszavonás-történeten szerkeszthető. A projekt-előnézet és a feed-poszter ebből készül, és ha a
 * lap változik, a poszter is újra.
 */

/** a thumbnail vászna a projekt képarányán, a leghosszabb oldal 1280 px */
export function thumbnailCanvas(aspect: number): { width: number; height: number } {
  const a = aspect > 0 ? aspect : 16 / 9;
  return a >= 1 ? { width: 1280, height: Math.round(1280 / a) } : { width: Math.round(1280 * a), height: 1280 };
}

/**
 * Képkocka-jelöltek a videó első klipjéből (forrás-idő mp-ben): a látható szakasz 15/35/55/75%-a.
 * A telefon ezekből kér képkockát — nincs szerveres kiválasztás.
 */
export function thumbnailFrameTimes(project: Pick<Project, 'tracks'>, count = 4): { clip: VideoClip; times: number[] } | null {
  const clip = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video')
    .sort((a, b) => a.start - b.start)[0];
  if (!clip) return null;
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const span = clip.duration * speed;
  const trimIn = clip.trimIn ?? 0;
  const n = Math.max(1, Math.min(8, count));
  const times = Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 0.35 : 0.15 + (0.6 * i) / (n - 1);
    return Math.round((trimIn + span * f) * 100) / 100;
  });
  return { clip, times };
}

/**
 * A thumbnail-dokumentum: a képkocka teljes vásznon (`cover`), alul a cím (ha van) fehér, fekete
 * körvonallal — a Kép Stúdióban minden réteg tovább szerkeszthető.
 */
export function thumbnailDoc(opts: {
  id: string;
  name: string;
  frameUri: string;
  headline?: string | null;
  aspect: number;
  aspectRatio: AspectRatio;
  layerId: (prefix: string) => string;
}): ImageDoc {
  const { width, height } = thumbnailCanvas(opts.aspect);
  const layers: ImageLayer[] = [
    { kind: 'photo', id: opts.layerId('lyr'), name: 'Képkocka', uri: opts.frameUri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' } as ImageLayer,
  ];
  const headline = opts.headline?.trim();
  if (headline) {
    layers.push({
      kind: 'text',
      id: opts.layerId('lyr'),
      name: 'Cím',
      text: headline,
      position: { x: 0.5, y: 0.8 },
      fontSize: 14,
      color: '#ffffff',
      fontFamily: 'Poppins',
      fontWeight: 'bold',
      textAlign: 'center',
      backgroundColor: null,
      stroke: { color: '#000000', width: 0.012 },
      boxWidth: 0.9,
    } as unknown as ImageLayer);
  }
  return { id: opts.id, name: opts.name, aspectRatio: opts.aspectRatio, width, height, layers } as unknown as ImageDoc;
}

/** a projekt thumbnail-dokumentuma (ha van) */
export function thumbnailDocOf(project: Pick<Project, 'thumbnailDocId' | 'imageDocs'>): ImageDoc | null {
  if (!project.thumbnailDocId) return null;
  return project.imageDocs?.find((d) => d.id === project.thumbnailDocId) ?? null;
}

/**
 * Kell-e új feed-poszter: nincs még, vagy a thumbnail-lap azóta változott (a poszter a lap
 * verziójával mentődik). Thumbnail nélkül a régi szabály: csak ha még nincs.
 */
export function posterNeedsRefresh(rendered: Pick<RenderedVersion, 'url' | 'posterUrl' | 'posterKey'> | undefined, thumb: ImageDoc | null): boolean {
  if (!rendered?.url) return false;
  if (!thumb) return !rendered.posterUrl;
  return !rendered.posterUrl || rendered.posterKey !== stillVersion(thumb);
}
