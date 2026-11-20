import { applyCommand, type EditorCommand } from '@/lib/commands';
import type { Project } from '@/types/project';
import { norm, splitClauses } from '@/lib/intent/audio/text';
import { numberWordsToDigits } from '@/lib/intent/audio/dictation';
import { ownTracks } from '@/lib/intent/audio/tracks';
import { clause } from '@/lib/intent/audio/clause';
import type { AudioIntentContext, AudioIntentResult } from '@/lib/intent/audio/types';

/** 🎙️ A mondat értelmezése: tagmondatok, sáv-öröklés, töredék-összevonás, lépés-sorrend a command buson. */

/** a mondat értelmezése: lépések (a command buson, egy undo), műveletek és a nem értett részek */
export function parseAudioIntent(raw: string, ctx: AudioIntentContext): AudioIntentResult {
  const out: AudioIntentResult = { steps: [], actions: [], unknown: [] };
  if (!raw.trim() || raw.length > 500) return out;
  // a diktálásban leszakadó mennyiség („…zenét, hat decibellel”) az előző tagmondathoz tartozik
  const parts = splitClauses(raw).reduce<string[]>((acc, part) => {
    const amountOnly = /^(\S+\s+)?\d*\s*(db|decibel\w*)\b/.test(numberWordsToDigits(norm(part)));
    if (amountOnly && acc.length > 0) acc[acc.length - 1] = `${acc[acc.length - 1]} ${part}`;
    else acc.push(part);
    return acc;
  }, []);
  const own = parts.map((p) => ownTracks(norm(p), ctx));
  /** egy tagmondat értelmezése a megadott állapoton (a sáv nélküli a szomszéd sávját örökli) */
  const one = (text: string, i: number, j: number, project: Project): AudioIntentResult => {
    const r: AudioIntentResult = { steps: [], actions: [], unknown: [] };
    const mine = ownTracks(norm(text), ctx);
    const next = own.slice(j + 1).find((x) => x.length > 0);
    const prev = own.slice(0, i).reverse().find((x) => x.length > 0);
    const inherited = mine.length > 0 ? [] : (next ?? prev ?? []);
    if (!clause(text, { ...ctx, project, inherited }, r)) r.unknown.push(text);
    return r;
  };
  const advance = (project: Project, r: AudioIntentResult) => r.steps.reduce((p, step) => step.commands.reduce((q, cmd) => applyCommand(q, cmd) ?? q, p), project);
  // a diktálás vesszővel szétszabdalhatja a mondatot („Masteray Y-u, YouTubera, és tegyél, markert ide”):
  // a magában nem érthető darab a következővel, különben az előzővel együtt próbálkozik — és csak akkor
  // fogadja el az összevonást, ha az maradék nélkül érthető
  const done: { text: string; from: number; to: number; before: Project; r: AudioIntentResult }[] = [];
  let working = ctx.project;
  for (let i = 0; i < parts.length; i++) {
    const r = one(parts[i], i, i, working);
    // csak rövid (≤ 2 szavas) töredék olvadhat össze — egy egész, értelmetlen tagmondatot nem nyelünk el
    const fragment = parts[i].trim().split(/\s+/).length <= 2;
    if (r.unknown.length > 0 && fragment && i + 1 < parts.length) {
      const merged = one(`${parts[i]} ${parts[i + 1]}`, i, i + 1, working);
      if (merged.unknown.length === 0) {
        done.push({ text: `${parts[i]} ${parts[i + 1]}`, from: i, to: i + 1, before: working, r: merged });
        working = advance(working, merged);
        i++;
        continue;
      }
    }
    const last = done[done.length - 1];
    if (r.unknown.length > 0 && fragment && last && last.r.unknown.length === 0) {
      const merged = one(`${last.text} ${parts[i]}`, last.from, i, last.before);
      // visszafelé csak akkor, ha a töredék valamit hozzátesz (pl. a master célját)
      if (merged.unknown.length === 0 && JSON.stringify(merged.steps) !== JSON.stringify(last.r.steps)) {
        done[done.length - 1] = { text: `${last.text} ${parts[i]}`, from: last.from, to: i, before: last.before, r: merged };
        working = advance(last.before, merged);
        continue;
      }
    }
    done.push({ text: parts[i], from: i, to: i, before: working, r });
    working = advance(working, r);
  }
  for (const d of done) {
    out.steps.push(...d.r.steps);
    out.actions.push(...d.r.actions);
    out.unknown.push(...d.r.unknown);
  }
  return out;
}

/** az összes lépés parancsai egyetlen kötegben (egy visszavonás) */
export const intentCommands = (r: AudioIntentResult): EditorCommand[] => r.steps.flatMap((s) => s.commands);
