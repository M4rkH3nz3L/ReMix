import { t as tr } from 'i18next';

import type { AiCommand, AssistantReply } from '@/lib/aiCommands';
import { clipEnd } from '@/lib/projectUtils';
import type { Clip, Project } from '@/types/project';

/**
 * 🧩 Lokális szándék-értelmező — determinista sablon-parser (local-ai Fázis C;
 * „mindenből legyen ingyenes local").
 *
 * Az asszisztens leggyakoribb, egyértelmű utasításait (vágás, törlés, felirat,
 * képarány, átnevezés, sebesség, némítás) HELYBEN fordítja `AiCommand`-okra —
 * ingyen, offline, azonnal. CSAK magabiztos találatnál ad eredményt; minden
 * másra `null` → a hívó a worker-útra megy. A kimenet UGYANAZON a
 * `validateAiCommand` határon megy át, mint a worker-é (nincs „megbízható
 * lokál" kivétel). Expo-mentes, tiszta → önmagában tesztelt.
 */

export interface LocalIntentContext {
  project: Project;
  playhead: number;
  selectedClipId: string | null;
}

/** idő-kifejezés: „4 másodpercnél", „2.5 mp", „at 3s", „1:23" */
function parseTime(text: string): number | null {
  const mmss = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (mmss) {
    return Number(mmss[1]) * 60 + Number(mmss[2]);
  }
  // a magyar toldalék is illeszkedik: „másodpercnél", „mp-nél", „sec-re"
  const sec = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:másodperc\w*|masodperc\w*|mp|sec(?:onds?)?|s)\b/i);
  if (sec) {
    return Number(sec[1].replace(',', '.'));
  }
  return null;
}

/** idézett szöveg: „…” / "…" / '…' */
function quoted(text: string): string | null {
  const m = text.match(/[„"']([^„"”']{1,80})["”']?/);
  const q = m?.[1]?.trim();
  return q && q.length > 0 ? q : null;
}

/** az adott időpontot fedő klip a videósávon (ha nincs kijelölés) */
function clipAt(project: Project, time: number): Clip | null {
  for (const track of project.tracks) {
    if (track.type !== 'video') {
      continue;
    }
    const hit = track.clips.find((c) => time > c.start && time < clipEnd(c));
    if (hit) {
      return hit;
    }
  }
  return null;
}

function selectedClip(ctx: LocalIntentContext): Clip | null {
  if (!ctx.selectedClipId) {
    return null;
  }
  for (const track of ctx.project.tracks) {
    const hit = track.clips.find((c) => c.id === ctx.selectedClipId);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function reply(commands: AiCommand[]): AssistantReply {
  return { message: tr('lib.localIntent.applied', { count: commands.length }), commands };
}

/**
 * Az utasítás helyi értelmezése. `null` = nincs magabiztos találat (→ worker).
 * A sorrend a specifikusabb mintáktól halad az általánosabbak felé.
 */
export function parseLocalIntent(
  instruction: string,
  ctx: LocalIntentContext,
): AssistantReply | null {
  const text = (instruction ?? '').trim();
  if (text.length === 0 || text.length > 200) {
    return null; // hosszú/összetett kérés → valódi modell
  }
  const lower = text.toLowerCase();

  // ✂️ vágás: „vágd ketté 4 másodpercnél" / „cut at 3s" / „vágd el itt"
  if (/\b(vágd|vágjad|cut|split)\b/.test(lower)) {
    const at = parseTime(lower) ?? (/(itt|most|playhead|here|now)/.test(lower) ? ctx.playhead : null);
    if (at != null) {
      const target = selectedClip(ctx) ?? clipAt(ctx.project, at);
      if (target && at > target.start && at < clipEnd(target)) {
        return reply([{ type: 'SPLIT_CLIP', clipId: target.id, time: at }]);
      }
    }
    return null;
  }

  // 🗑️ törlés: „töröld a kijelölt klipet" (csak kijelöléssel — különben kétértelmű)
  if (/\b(töröld|torold|távolítsd el|dobd ki|delete|remove)\b/.test(lower) && /\b(klip|clip)/.test(lower)) {
    const target = selectedClip(ctx);
    return target ? reply([{ type: 'REMOVE_CLIP', clipId: target.id }]) : null;
  }

  // 📐 képarány: „állítsd 9:16-ra" / „legyen 16:9"
  const aspect = lower.match(/\b(9:16|16:9|1:1)\b/);
  if (aspect && /(képarány|keparany|arány|arany|aspect|állítsd|allitsd|váltsd|valtsd|legyen|formátum|formatum|set)/.test(lower)) {
    return reply([{ type: 'SET_ASPECT', aspectRatio: aspect[1] as Project['aspectRatio'] }]);
  }

  // ✏️ átnevezés: „nevezd át erre: „Nyári vlog"" (idézett név kell)
  if (/(nevezd át|nevezd at|átnevez|atnevez|rename)/.test(lower)) {
    const name = quoted(text);
    return name ? reply([{ type: 'RENAME_PROJECT', name }]) : null;
  }

  // 💬 szöveg/felirat: „írd ki: „Kövess be!"" — idézett tartalom kell
  if (/(felirat|szöveg|szoveg|írd ki|ird ki|text)/.test(lower)) {
    const content = quoted(text);
    if (content) {
      const trackType = /(felirat|caption)/.test(lower) ? 'captions' : 'text';
      return reply([
        {
          type: 'ADD_TEXT_CLIPS',
          trackType,
          clips: [{ text: content, start: Math.max(0, ctx.playhead), duration: 2.5 }],
        },
      ]);
    }
    return null;
  }

  // 🐢/🐇 sebesség: „lassítsd felére" / „gyorsítsd 2x-re" (kijelölt klipen)
  if (/(lassítsd|lassitsd|gyorsítsd|gyorsitsd|slow down|speed up)/.test(lower)) {
    const target = selectedClip(ctx);
    if (!target) {
      return null;
    }
    const mult = lower.match(/(\d+(?:[.,]\d+)?)\s*x/);
    const slow = /(lassítsd|lassitsd|slow)/.test(lower);
    const speed = mult ? Number(mult[1].replace(',', '.')) : slow ? 0.5 : 2;
    if (speed < 0.1 || speed > 10) {
      return null;
    }
    return reply([{ type: 'UPDATE_CLIP', clipId: target.id, patch: { speed } }]);
  }

  // 🔇 némítás: „némítsd le a klipet" (kijelölt klipen)
  if (/(némítsd|nemitsd|mute)/.test(lower)) {
    const target = selectedClip(ctx);
    return target
      ? reply([{ type: 'UPDATE_CLIP', clipId: target.id, patch: { volume: 0 } }])
      : null;
  }

  return null;
}
