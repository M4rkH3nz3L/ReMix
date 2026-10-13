/**
 * 🖼️➡️📲 Kép-projekt → FEED megosztás transzformáció (TECH-TOP §2.2) — pure + tesztelt.
 *
 * A kép-projekt egy GALÉRIA (`project.imageDocs`: több, külön szerkeszthető lap). Megosztáskor
 * KÉTFÉLE poszt lehet belőle:
 *  - 🎞️ **diavetítés (slideshow)**: a lapokból időzített VIDEÓ (a `slideshow` mag + a meglévő
 *    videó-render); a feedben sima lejátszható poszt.
 *  - 🖐️ **lapozható (carousel)**: a lapok renderelt PNG-jei vízszintesen lapozhatók (a feed-kártya
 *    kép-pagere); nincs render, a képek URL-listája a poszton.
 *
 * Ez a mag DÖNT és ÉPÍT (expo-mentes → tesztelhető); a tényleges render/feltöltés/posztolás a
 * `feed.publishImageProject`-ben köti össze.
 */
import type { ImageDoc, Project } from '@/types/project';
import { imagePages } from './imageProjectPages';
import {
  backgroundMusicClip,
  clampPerSlideForMax,
  DEFAULT_PER_SLIDE_SEC,
  slideshowDurationSec,
  slideshowPlan,
  type SlideSource,
  type SlideshowOptions,
} from './slideshow';

export type ImageShareMode = 'slideshow' | 'carousel';

/** A lapok, amelyeknek MÁR van renderelt PNG-je (a megosztáshoz ez kell). */
export function renderedPages(project: Pick<Project, 'imageDocs'>): ImageDoc[] {
  return imagePages(project).filter((d) => typeof d.renderedUri === 'string' && d.renderedUri.length > 0);
}

/** Azok a lapok, amelyeket MÉG rasterizálni kell (a hívó rasterizálja megosztás előtt). */
export function unrenderedPages(project: Pick<Project, 'imageDocs'>): ImageDoc[] {
  return imagePages(project).filter((d) => !d.renderedUri);
}

/** Minden lapnak van renderelt PNG-je? (a megosztás előfeltétele) */
export function allPagesRendered(project: Pick<Project, 'imageDocs'>): boolean {
  const pages = imagePages(project);
  return pages.length > 0 && pages.every((d) => !!d.renderedUri);
}

/** A diavetítés-forrásK (`slideshow` mag bemenete) a renderelt lapokból. */
export function imageDocSources(project: Pick<Project, 'imageDocs'>): SlideSource[] {
  return renderedPages(project).map((d) => ({ id: d.id, uri: d.renderedUri as string }));
}

/** A karusszel kép-URI-listája (a renderelt lapok sorrendben). */
export function carouselImageUris(project: Pick<Project, 'imageDocs'>): string[] {
  return renderedPages(project).map((d) => d.renderedUri as string);
}

/** Alap megosztás-mód: 1 lap → nincs értelme lapozni/diavetíteni, de a carousel a biztonságos default. */
export function defaultShareMode(pageCount: number): ImageShareMode {
  return pageCount >= 2 ? 'slideshow' : 'carousel';
}

export interface SlideshowBuildOptions extends SlideshowOptions {
  /** opcionális háttérzene a diavetítés teljes hosszára */
  musicUri?: string;
  /** auto-fit: ha a kért perSlideSec-cel túllépné a 10 perc-plafont, lekicsinyíti */
  autoFit?: boolean;
}

/**
 * A kép-projektből DIAVETÍTÉS-projekt (a meglévő videó-render renderelje): egy `video`
 * sávon a lapok `ImageClip`-jei (időzítve + átmenettel), opcionális `music` sávon a
 * háttérzene. A 10 perc-plafon betartva (auto-fit a per-slide hosszon, ha kell). A
 * `rendered` cache ürítve (friss render). `null`, ha nincs renderelt lap.
 */
export function buildSlideshowProject(project: Project, opts: SlideshowBuildOptions = {}): Project | null {
  const sources = imageDocSources(project);
  if (sources.length === 0) {
    return null;
  }
  // auto-fit a 10 perc-plafonhoz (alap: be)
  const requested = Number(opts.perSlideSec) > 0 ? Number(opts.perSlideSec) : DEFAULT_PER_SLIDE_SEC;
  const autoFit = opts.autoFit !== false;
  const fitted = autoFit ? Math.min(requested, clampPerSlideForMax(sources.length)) : requested;
  const slideOpts: SlideshowOptions = {
    perSlideSec: fitted,
    transition: opts.transition,
    transitionSec: opts.transitionSec,
  };
  const clips = slideshowPlan(sources, slideOpts);
  const totalSec = slideshowDurationSec(sources.length, slideOpts);

  const tracks: Project['tracks'] = [
    { id: 'slideshow-video', type: 'video', name: 'Diavetítés', clips },
  ];
  if (opts.musicUri) {
    tracks.push({
      id: 'slideshow-music',
      type: 'music',
      name: 'Zene',
      clips: [backgroundMusicClip(opts.musicUri, totalSec)],
    });
  }

  return {
    ...project,
    kind: 'image',
    tracks,
    rendered: undefined,
  };
}
