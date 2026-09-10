import { makeId } from '@/lib/id';
import { createEmptyProject } from '@/lib/projectUtils';
import type {
  Asset,
  AudioClip,
  Clip,
  Project,
  TextClip,
  TrackType,
  VideoClip,
} from '@/types/project';

/**
 * Demó-projekt építők (pure, expo-mentes, tesztelhető) — a feloldott médiából
 * állítja össze a bemutató-projekteket; a letöltés/mentés a demoProjects.ts-ben.
 */

export interface DemoMedia {
  uri: string;
  duration: number;
  provider: Asset['provider'];
}

function asset(kind: Asset['kind'], name: string, media: DemoMedia): Asset {
  return {
    id: makeId('ast'),
    kind,
    uri: media.uri,
    provider: media.provider,
    name,
    duration: media.duration,
  };
}

function videoClip(
  a: Asset,
  over: Partial<VideoClip> & { start: number; duration: number }
): VideoClip {
  return {
    kind: 'video',
    id: makeId('clip'),
    uri: a.uri,
    assetId: a.id,
    trimIn: 0,
    sourceDuration: a.duration ?? over.duration,
    speed: 1,
    volume: 1,
    filterId: 'none',
    ...over,
  };
}

function textClip(
  over: Partial<TextClip> & { start: number; duration: number; text: string }
): TextClip {
  return {
    kind: 'text',
    id: makeId('clip'),
    color: '#ffffff',
    backgroundColor: null,
    fontSize: 6,
    fontWeight: 'bold',
    position: { x: 0.5, y: 0.5 },
    animation: 'pop',
    stylePreset: 'bubble',
    ...over,
  };
}

function musicClip(
  a: Asset,
  over: Partial<AudioClip> & { start: number; duration: number }
): AudioClip {
  return {
    kind: 'audio',
    id: makeId('clip'),
    uri: a.uri,
    assetId: a.id,
    label: a.name ?? 'Zene',
    volume: 0.7,
    fadeIn: 0.5,
    fadeOut: 1,
    source: 'imported',
    ...over,
  };
}

function fill(project: Project, byType: Partial<Record<TrackType, Clip[]>>): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      byType[t.type] ? { ...t, clips: byType[t.type]! } : t
    ),
  };
}

/** A demó-projektek összeállítása a feloldott médiából. */
export function buildDemoProjects(media: {
  szines: DemoMedia;
  fraktal: DemoMedia;
  zold: DemoMedia;
  beszed: DemoMedia;
  zene: DemoMedia;
  voice: DemoMedia;
  whoosh: DemoMedia;
  click: DemoMedia;
}): { project: Project; assets: Asset[] }[] {
  const out: { project: Project; assets: Asset[] }[] = [];

  // 0) Hangsávok — réteges hang hullámformákkal (látványterv-demó) ---------
  {
    const aV = asset('video', 'Színes gradiens', media.szines);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    const aVo = asset('audio', 'Beszéd (voiceover)', media.voice);
    const aW = asset('audio', 'Whoosh', media.whoosh);
    const aC = asset('audio', 'Click', media.click);
    let p = createEmptyProject('🎧 Demó — Hangsávok', '9:16');
    const dur = 8;
    p = fill(p, {
      video: [
        videoClip(aV, {
          start: 0,
          duration: dur,
          volume: 0,
          backgroundFill: 'blur',
          keyframes: {
            scale: [
              { time: 0, value: 1.1, easing: 'easeInOut' },
              { time: dur, value: 1.35, easing: 'easeInOut' },
            ],
          },
        }),
      ],
      text: [
        textClip({
          start: 0.3,
          duration: 3,
          text: '🎧 Réteges hang',
          stylePreset: 'outline',
          fontSize: 6,
          position: { x: 0.5, y: 0.15 },
        }),
        textClip({
          start: 3.6,
          duration: 4,
          text: 'zene + voiceover + SFX egyszerre',
          fontSize: 4.5,
          position: { x: 0.5, y: 0.85 },
        }),
      ],
      // a zene ducking-gal hátrébb lép a beszéd alatt; a voiceover Enhance-t kap
      music: [musicClip(aM, { start: 0, duration: dur, volume: 0.5, autoDuck: true })],
      voiceover: [
        musicClip(aVo, {
          start: 0.4,
          duration: Math.min(7.5, media.voice.duration),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          source: 'voiceover',
          voiceEnhance: true,
        }),
      ],
      sfx: [
        musicClip(aW, {
          start: 0.1,
          duration: Math.min(0.8, media.whoosh.duration || 0.8),
          volume: 0.9,
          fadeIn: 0,
          fadeOut: 0,
        }),
        musicClip(aC, {
          start: 4,
          duration: Math.min(0.4, media.click.duration || 0.4),
          volume: 0.9,
          fadeIn: 0,
          fadeOut: 0,
        }),
      ],
    });
    out.push({ project: p, assets: [aV, aM, aVo, aW, aC] });
  }

  // 1) Kulcskockás mozgás + blur-háttér ------------------------------------
  {
    const aV = asset('video', 'Színes gradiens', media.szines);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    let p = createEmptyProject('✨ Demó — Kulcskockás mozgás', '9:16');
    const dur = Math.min(8, media.szines.duration);
    p = fill(p, {
      video: [
        videoClip(aV, {
          start: 0,
          duration: dur,
          volume: 0,
          backgroundFill: 'blur',
          keyframes: {
            scale: [
              { time: 0, value: 1, easing: 'easeInOut' },
              { time: dur / 2, value: 1.7, easing: 'easeInOut' },
              { time: dur, value: 1.15, easing: 'easeInOut' },
            ],
            x: [
              { time: 0, value: 0, easing: 'easeInOut' },
              { time: dur / 2, value: 0.14, easing: 'easeInOut' },
              { time: dur, value: -0.08, easing: 'easeInOut' },
            ],
            y: [
              { time: 0, value: 0, easing: 'easeInOut' },
              { time: dur, value: 0.06, easing: 'easeInOut' },
            ],
          },
        }),
      ],
      text: [
        textClip({
          start: 0.3,
          duration: 2.2,
          text: 'Remix',
          fontSize: 11,
          color: '#c447d6',
          stylePreset: 'neon',
          position: { x: 0.5, y: 0.3 },
        }),
        textClip({
          start: 2.8,
          duration: 4.4,
          text: 'Kulcskockás zoom + blur háttér',
          fontSize: 4.5,
          position: { x: 0.5, y: 0.78 },
        }),
      ],
      music: [musicClip(aM, { start: 0, duration: dur })],
    });
    out.push({ project: p, assets: [aV, aM] });
  }

  // 2) Maszk + green screen -------------------------------------------------
  {
    const aF = asset('video', 'Fraktál-zoom', media.fraktal);
    const aZ = asset('video', 'Green screen', media.zold);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    let p = createEmptyProject('🎭 Demó — Maszk és green screen', '9:16');
    const d1 = Math.min(4, media.fraktal.duration);
    const d2 = Math.min(5, media.zold.duration);
    p = fill(p, {
      video: [
        videoClip(aF, {
          start: 0,
          duration: d1,
          volume: 0,
          mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.78, h: 0.5, feather: 0.08 },
        }),
        videoClip(aZ, {
          start: d1,
          duration: d2,
          volume: 0,
          chromaKey: { color: '#00ff00', similarity: 0.22 },
        }),
      ],
      text: [
        textClip({
          start: 0.4,
          duration: d1 - 0.6,
          text: 'Lágy szélű maszk',
          stylePreset: 'outline',
          position: { x: 0.5, y: 0.14 },
        }),
        textClip({
          start: d1 + 0.5,
          duration: d2 - 1,
          text: 'Green screen ✂️',
          position: { x: 0.5, y: 0.16 },
        }),
      ],
      overlay: [
        textClip({
          start: d1 + 0.5,
          duration: d2 - 1,
          text: '🪄',
          fontSize: 10,
          position: { x: 0.82, y: 0.32 },
        }),
      ],
      music: [musicClip(aM, { start: 0, duration: d1 + d2, volume: 0.6 })],
    });
    out.push({ project: p, assets: [aF, aZ, aM] });
  }

  // 3) Beat-vágás -----------------------------------------------------------
  {
    const aF = asset('video', 'Fraktál-zoom', media.fraktal);
    const aS = asset('video', 'Színes gradiens', media.szines);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    let p = createEmptyProject('🎵 Demó — Beat-vágás', '9:16');
    // pörgős jump-cutok: fél másodperces darabok a forrás különböző pontjairól
    const trims = [0, 2.5, 5, 1.2, 3.8, 6.2, 0.6, 4.4];
    const cuts: Clip[] = trims.map((trimIn, i) =>
      videoClip(aF, {
        start: i * 0.5,
        duration: 0.5,
        trimIn,
        volume: 0,
      })
    );
    const tail = videoClip(aS, {
      start: trims.length * 0.5,
      duration: 3.5,
      volume: 0,
      backgroundFill: 'blur',
      keyframes: {
        scale: [
          { time: 0, value: 1.05, easing: 'easeOut' },
          { time: 3.5, value: 1.5, easing: 'easeOut' },
        ],
      },
    });
    p = fill(p, {
      video: [...cuts, tail],
      text: [
        textClip({
          start: 0.2,
          duration: 3.6,
          text: 'Vágás a zene ütemére',
          animation: 'karaoke',
          stylePreset: 'outline',
          position: { x: 0.5, y: 0.2 },
          fontSize: 5.5,
        }),
        textClip({
          start: 4.4,
          duration: 2.8,
          text: '🎵 Auto Beat Edit',
          position: { x: 0.5, y: 0.78 },
          fontSize: 5,
        }),
      ],
      music: [
        musicClip(aM, { start: 0, duration: trims.length * 0.5 + 3.5, fadeIn: 0 }),
      ],
    });
    out.push({ project: p, assets: [aF, aS, aM] });
  }

  // 4) Beszéd + felirat + Voice Studio -------------------------------------
  {
    const aB = asset('video', 'Beszédes klip', media.beszed);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    let p = createEmptyProject('🎙️ Demó — Felirat és Voice Studio', '9:16');
    const dur = Math.min(7.6, media.beszed.duration);
    p = fill(p, {
      video: [
        videoClip(aB, { start: 0, duration: dur, volume: 1, voiceEnhance: true }),
      ],
      text: [
        textClip({
          start: 0.3,
          duration: 2.6,
          text: '✨ Enhance Voice + auto-felirat',
          stylePreset: 'outline',
          fontSize: 4.5,
          position: { x: 0.5, y: 0.12 },
        }),
      ],
      captions: [
        textClip({
          start: 0.1,
          duration: 2.3,
          text: 'Ez itt a Remix alkalmazás tesztje',
          fontSize: 5,
          position: { x: 0.5, y: 0.78 },
        }),
        textClip({
          start: 2.5,
          duration: 3,
          text: 'az automatikus felirat a beszédből készül',
          fontSize: 5,
          position: { x: 0.5, y: 0.78 },
        }),
        textClip({
          start: 5.6,
          duration: 1.9,
          text: 'próbáld ki te is! 🚀',
          fontSize: 5,
          position: { x: 0.5, y: 0.78 },
        }),
      ],
      // a zene automatikusan lehalkul a beszéd alatt (sidechain-ducking)
      music: [musicClip(aM, { start: 0, duration: dur, volume: 0.55, autoDuck: true })],
    });
    out.push({ project: p, assets: [aB, aM] });
  }

  // 5) Minden egyben (mini-showreel) ---------------------------------------
  {
    const aS = asset('video', 'Színes gradiens', media.szines);
    const aF = asset('video', 'Fraktál-zoom', media.fraktal);
    const aZ = asset('video', 'Green screen', media.zold);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    let p = createEmptyProject('🚀 Demó — Minden egyben', '9:16');
    p = fill(p, {
      video: [
        videoClip(aS, {
          start: 0,
          duration: 2.2,
          volume: 0,
          backgroundFill: 'blur',
          keyframes: {
            scale: [
              { time: 0, value: 1, easing: 'easeIn' },
              { time: 2.2, value: 1.6, easing: 'easeIn' },
            ],
          },
        }),
        videoClip(aF, {
          start: 2.2,
          duration: 2.6,
          trimIn: 3,
          volume: 0,
          mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.8, h: 0.55, feather: 0.1 },
        }),
        videoClip(aZ, {
          start: 4.8,
          duration: 3,
          volume: 0,
          chromaKey: { color: '#00ff00', similarity: 0.22 },
        }),
      ],
      text: [
        textClip({
          start: 0.2,
          duration: 1.8,
          text: 'Remix',
          fontSize: 12,
          color: '#c447d6',
          stylePreset: 'neon',
          position: { x: 0.5, y: 0.42 },
        }),
        textClip({
          start: 2.4,
          duration: 2.2,
          text: 'AI Creator OS',
          animation: 'typewriter',
          stylePreset: 'outline',
          fontSize: 7,
          position: { x: 0.5, y: 0.45 },
        }),
        textClip({
          start: 5.2,
          duration: 2.4,
          text: 'Készítsd el a sajátod! 📱',
          fontSize: 5,
          position: { x: 0.5, y: 0.8 },
        }),
      ],
      overlay: [
        textClip({
          start: 0.4,
          duration: 1.6,
          text: '🔥',
          fontSize: 9,
          position: { x: 0.8, y: 0.22 },
        }),
      ],
      music: [musicClip(aM, { start: 0, duration: 7.8 })],
    });
    out.push({ project: p, assets: [aS, aF, aZ, aM] });
  }

  // 6) 3D tér, mozgás-elmosás és részecskék (3D V2 + speed ramp v2) --------
  {
    const aS = asset('video', 'Színes gradiens', media.szines);
    const aF = asset('video', 'Fraktál-zoom', media.fraktal);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    let p = createEmptyProject('🧊 Demó — 3D tér & mozgás', '9:16');
    p = fill(p, {
      video: [
        // 3D döntés + neon világítás — a klip „lapként” fordul a térben
        videoClip(aS, {
          start: 0,
          duration: 2.6,
          volume: 0,
          backgroundFill: 'blur',
          tilt3d: { rotX: 10, rotY: -18 },
          lighting: 'neon',
          transitionOut: { type: 'cube', duration: 0.4 },
        }),
        // speed ramp két darabja: gyorsítás elmosással, majd lassítás
        // interpolált köztes kockákkal — a mozgás-elmosás a renderben látszik
        videoClip(aF, {
          start: 2.6,
          duration: 1.4,
          trimIn: 2,
          volume: 0,
          speed: 2.4,
          motionBlur: 0.8,
          lighting: 'cyberpunk',
        }),
        videoClip(aF, {
          start: 4,
          duration: 2.2,
          trimIn: 5.4,
          volume: 0,
          speed: 0.45,
          motionBlur: 0.6,
          lighting: 'sunset',
        }),
        // freeform (poligon) maszk — gyémánt-kivágás
        videoClip(aS, {
          start: 6.2,
          duration: 2.4,
          trimIn: 1,
          volume: 0,
          backgroundFill: 'blur',
          mask: {
            shape: 'polygon',
            x: 0.5,
            y: 0.5,
            w: 0.86,
            h: 0.7,
            feather: 0.06,
            // a 16:9 forrás a 9:16 vásznon csak az y 0,34–0,66 sávban látszik
            // (contain-fit a blur-háttér fölött) — a csúcsok ezen belül vannak,
            // különben a maszk teteje/alja levágódna
            points: [
              { x: 0.5, y: 0.355 },
              { x: 0.86, y: 0.5 },
              { x: 0.5, y: 0.645 },
              { x: 0.14, y: 0.5 },
            ],
          },
        }),
      ],
      text: [
        textClip({
          start: 0.3,
          duration: 2.1,
          text: '3D döntés + fény',
          stylePreset: 'outline',
          fontSize: 6.5,
          position: { x: 0.5, y: 0.16 },
        }),
        textClip({
          start: 2.8,
          duration: 1.1,
          text: '⚡ gyorsítás — mozgás-elmosással',
          fontSize: 4.5,
          position: { x: 0.5, y: 0.85 },
        }),
        textClip({
          start: 4.2,
          duration: 1.8,
          text: '🐢 lassítás — interpolált kockákkal',
          fontSize: 4.5,
          position: { x: 0.5, y: 0.85 },
        }),
        textClip({
          start: 6.5,
          duration: 1.9,
          text: 'freeform maszk',
          stylePreset: 'neon',
          fontSize: 6,
          position: { x: 0.5, y: 0.83 },
        }),
      ],
      music: [musicClip(aM, { start: 0, duration: 8.6 })],
    });
    // részecske-réteg a zene ütemeire (a renderbe ég, a feliratok alá)
    p = { ...p, particles: { preset: 'sparkle', beatSync: true, intensity: 1.1 } };
    out.push({ project: p, assets: [aS, aF, aM] });
  }

  // 7) Márka-intro/outro + Sound Design (a vágásokra hangolt SFX) ----------
  {
    const aB = asset('video', 'Beszéd', media.beszed);
    const aS = asset('video', 'Színes gradiens', media.szines);
    const aM = asset('audio', 'Lo-fi demó', media.zene);
    const aW = asset('audio', 'Whoosh', media.whoosh);
    const aC = asset('audio', 'Click', media.click);
    let p = createEmptyProject('🎬 Demó — Márka intro/outro', '9:16');
    const accent = '#ff2d55';
    const introDur = 1.6;
    const bodyEnd = introDur + 6.4;
    const outroDur = 2.2;
    p = fill(p, {
      // az intro/outro alatt SZÁNDÉKOSAN nincs videóklip: a render fekete
      // alapot ad, arra jön a márkaszínű háttér-forma az overlay sávról
      video: [
        videoClip(aB, {
          start: introDur,
          duration: 3.4,
          volume: 1,
          backgroundFill: 'blur',
          lighting: 'studio',
          transitionOut: { type: 'dissolve', duration: 0.3 },
        }),
        videoClip(aS, {
          start: introDur + 3.4,
          duration: 3,
          volume: 0,
          backgroundFill: 'blur',
          keyframes: {
            scale: [
              { time: 0, value: 1.05, easing: 'easeInOut' },
              { time: 3, value: 1.3, easing: 'easeInOut' },
            ],
          },
        }),
      ],
      overlay: [
        // intro-háttér (márkaszín, kicsit túllóg a vásznon)
        {
          kind: 'shape',
          id: makeId('clip'),
          start: 0,
          duration: introDur,
          shape: 'rectangle',
          position: { x: 0.5, y: 0.5 },
          w: 1.04,
          h: 1.04,
          fill: accent,
          fillGradient: { from: accent, to: '#8c1a2f' },
        },
        // outro-háttér
        {
          kind: 'shape',
          id: makeId('clip'),
          start: bodyEnd,
          duration: outroDur,
          shape: 'rectangle',
          position: { x: 0.5, y: 0.5 },
          w: 1.04,
          h: 1.04,
          fill: accent,
          fillGradient: { from: accent, to: '#8c1a2f' },
        },
      ],
      text: [
        textClip({
          start: 0.1,
          duration: introDur - 0.1,
          text: 'Remix',
          fontSize: 13,
          stylePreset: 'plain',
          position: { x: 0.5, y: 0.46 },
        }),
        textClip({
          start: 0.45,
          duration: introDur - 0.45,
          text: 'AI Creator OS',
          fontSize: 5,
          animation: 'fade',
          stylePreset: 'plain',
          position: { x: 0.5, y: 0.6 },
        }),
        textClip({
          start: bodyEnd + 0.15,
          duration: outroDur - 0.15,
          text: 'Kövess be 🔔',
          fontSize: 10,
          stylePreset: 'plain',
          position: { x: 0.5, y: 0.44 },
        }),
        textClip({
          start: bodyEnd + 0.55,
          duration: outroDur - 0.55,
          text: 'Több ilyen videóért',
          fontSize: 5,
          animation: 'fade',
          stylePreset: 'plain',
          position: { x: 0.5, y: 0.58 },
        }),
      ],
      captions: [
        // kiemelt szavak (Caption Studio) — az emphasis indexek 0-alapúak
        textClip({
          start: introDur + 0.3,
          duration: 1.6,
          text: 'Három vágás, három hang',
          fontSize: 5.5,
          animation: 'karaoke',
          emphasis: [0],
          position: { x: 0.5, y: 0.78 },
        }),
        textClip({
          start: introDur + 2.1,
          duration: 1.5,
          text: 'a whoosh a vágásra esik',
          fontSize: 5.5,
          animation: 'karaoke',
          emphasis: [1],
          position: { x: 0.5, y: 0.78 },
        }),
      ],
      music: [musicClip(aM, { start: introDur, duration: 6.4, volume: 0.55, autoDuck: true })],
      // Sound Design: whoosh a vágásra (kicsit elé indítva), click az outróra
      sfx: [
        musicClip(aW, {
          start: introDur + 3.22,
          duration: Math.min(0.6, media.whoosh.duration || 0.6),
          volume: 0.62,
          fadeIn: 0,
          fadeOut: 0.12,
          label: 'Whoosh — vágás',
        }),
        musicClip(aC, {
          start: bodyEnd,
          duration: Math.min(0.4, media.click.duration || 0.4),
          volume: 0.5,
          fadeIn: 0,
          fadeOut: 0.1,
          label: 'Click — outro',
        }),
      ],
    });
    out.push({ project: p, assets: [aB, aS, aM, aW, aC] });
  }

  return out;
}
