/**
 * WebVTT (Web Video Text Tracks) felirat-szerializálás — a HTML5 `<track>` és a
 * legtöbb webes lejátszó natív felirat-formátuma. Az SRT-hez képest: `WEBVTT`
 * fejléc, pont (nem vessző) a tört-másodperc előtt, és opcionális pozíció/igazítás
 * cue-beállítások. Szándékosan expo-mentes → önmagában tesztelhető.
 */

import type { SrtCue } from '@/lib/srt';

/** mp → "HH:MM:SS.mmm" (WebVTT: pont a tizedesjel) */
function toVttTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms, 3)}`;
}

/** felirat-sor függőleges helye a VTT `line` cue-beállításához (0–1 → %-os sor) */
export interface VttCue extends SrtCue {
  /** 0–1 normalizált y-középpont; ha van, `line:NN%` kerül a cue-ba */
  y?: number;
}

/**
 * WebVTT szöveg a cue-kból. Ha egy cue-hoz van `y`, a sort a `line:NN%` +
 * `align:center` beállítással a megfelelő magasságra tesszük (a webes lejátszók
 * ezt tiszteletben tartják) — így a burn-in nélküli felirat is oda kerül, ahová
 * a szerkesztőben tetted.
 */
export function serializeVtt(cues: VttCue[]): string {
  const body = cues
    .map((cue, i) => {
      const setting = cue.y != null ? ` line:${Math.round(cue.y * 100)}%,center align:center` : '';
      return `${i + 1}\n${toVttTime(cue.start)} --> ${toVttTime(cue.end)}${setting}\n${cue.text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
