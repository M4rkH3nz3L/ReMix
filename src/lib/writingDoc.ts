import { memoryContext, type CreatorMemory } from '@/lib/creatorMemory';
import { charCount, readingTimeMin, wordCount } from '@/lib/markdown';

/**
 * ✍️ Writer Studio (S-WRITER — MASTER §9) — a `writing` CreativeDocument pure
 * modellje + parancs-reducere. Egy WritingDoc = Könyv → Fejezetek + „story
 * bible" (szereplők/helyszínek/kutatás/jegyzetek). Minden szerkesztő-művelet a
 * `applyWritingCommand` pure reducerén megy át (a command-bus filozófia a saját
 * állapotán → undo ingyen), és ÚJ dokumentumot ad vissza.
 *
 * Tiszta, expo-mentes; a nehéz AI-eszközök (rewrite/tone/translate/outline) a
 * `writeAssist` capability-n (cloud+pro) mennek majd — ez a modul csak az
 * on-device magot + az AI-kontextust adja.
 */

export interface Chapter {
  id: string;
  title: string;
  /** a fejezet Markdown-tartalma */
  body: string;
  /** rövid összefoglaló („mi történt ebben a fejezetben") — az AI-kontextushoz */
  synopsis?: string;
}

export type BibleEntryKind = 'character' | 'location' | 'research' | 'note';

export const BIBLE_KINDS: BibleEntryKind[] = ['character', 'location', 'research', 'note'];

export interface BibleEntry {
  id: string;
  kind: BibleEntryKind;
  name: string;
  description: string;
}

export interface WritingDoc {
  id: string;
  title: string;
  /** logline / rövid leírás a könyvről */
  logline?: string;
  chapters: Chapter[];
  bible: BibleEntry[];
  createdAt: string;
  updatedAt: string;
}

export function createWritingDoc(title: string, makeId: () => string, now: string): WritingDoc {
  return {
    id: makeId(),
    title: title.trim() || 'Untitled',
    chapters: [{ id: makeId(), title: '', body: '' }],
    bible: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Parancs-bus ──────────────────────────────────────────────────────────────

export type WritingCommand =
  | { type: 'SET_META'; patch: { title?: string; logline?: string } }
  | { type: 'ADD_CHAPTER'; title?: string; atIndex?: number }
  | { type: 'UPDATE_CHAPTER'; chapterId: string; patch: Partial<Pick<Chapter, 'title' | 'body' | 'synopsis'>> }
  | { type: 'REMOVE_CHAPTER'; chapterId: string }
  | { type: 'MOVE_CHAPTER'; chapterId: string; toIndex: number }
  | { type: 'ADD_BIBLE_ENTRY'; kind: BibleEntryKind; name?: string }
  | { type: 'UPDATE_BIBLE_ENTRY'; entryId: string; patch: Partial<Pick<BibleEntry, 'name' | 'description'>> }
  | { type: 'REMOVE_BIBLE_ENTRY'; entryId: string };

const clampIndex = (i: number, len: number): number => Math.max(0, Math.min(len, i));

/**
 * Egy parancs alkalmazása. ÚJ dokumentumot ad vissza a változásnál, vagy a
 * VÁLTOZATLAN referenciát, ha a művelet no-op (pl. ismeretlen id) — így a hívó
 * (és a memoizálás) megbízhatóan tudja, változott-e valami. A `now` a stamphez,
 * a `makeId` az új elemek azonosítójához.
 */
export function applyWritingCommand(
  doc: WritingDoc,
  cmd: WritingCommand,
  makeId: () => string,
  now: string
): WritingDoc {
  const touched = (next: Partial<WritingDoc>): WritingDoc => ({ ...doc, ...next, updatedAt: now });

  switch (cmd.type) {
    case 'SET_META': {
      const title = cmd.patch.title !== undefined ? cmd.patch.title.trim() || doc.title : doc.title;
      const logline = cmd.patch.logline !== undefined ? cmd.patch.logline : doc.logline;
      if (title === doc.title && logline === doc.logline) {
        return doc;
      }
      return touched({ title, logline });
    }

    case 'ADD_CHAPTER': {
      const chapter: Chapter = { id: makeId(), title: cmd.title?.trim() ?? '', body: '' };
      const chapters = doc.chapters.slice();
      chapters.splice(cmd.atIndex === undefined ? chapters.length : clampIndex(cmd.atIndex, chapters.length), 0, chapter);
      return touched({ chapters });
    }

    case 'UPDATE_CHAPTER': {
      let changed = false;
      const chapters = doc.chapters.map((c) => {
        if (c.id !== cmd.chapterId) {
          return c;
        }
        changed = true;
        return {
          ...c,
          ...(cmd.patch.title !== undefined ? { title: cmd.patch.title } : {}),
          ...(cmd.patch.body !== undefined ? { body: cmd.patch.body } : {}),
          ...(cmd.patch.synopsis !== undefined ? { synopsis: cmd.patch.synopsis } : {}),
        };
      });
      return changed ? touched({ chapters }) : doc;
    }

    case 'REMOVE_CHAPTER': {
      const chapters = doc.chapters.filter((c) => c.id !== cmd.chapterId);
      return chapters.length === doc.chapters.length ? doc : touched({ chapters });
    }

    case 'MOVE_CHAPTER': {
      const from = doc.chapters.findIndex((c) => c.id === cmd.chapterId);
      if (from === -1) {
        return doc;
      }
      const to = clampIndex(cmd.toIndex, doc.chapters.length - 1);
      if (to === from) {
        return doc;
      }
      const chapters = doc.chapters.slice();
      const [moved] = chapters.splice(from, 1);
      chapters.splice(to, 0, moved);
      return touched({ chapters });
    }

    case 'ADD_BIBLE_ENTRY': {
      const entry: BibleEntry = { id: makeId(), kind: cmd.kind, name: cmd.name?.trim() ?? '', description: '' };
      return touched({ bible: [...doc.bible, entry] });
    }

    case 'UPDATE_BIBLE_ENTRY': {
      let changed = false;
      const bible = doc.bible.map((e) => {
        if (e.id !== cmd.entryId) {
          return e;
        }
        changed = true;
        return {
          ...e,
          ...(cmd.patch.name !== undefined ? { name: cmd.patch.name } : {}),
          ...(cmd.patch.description !== undefined ? { description: cmd.patch.description } : {}),
        };
      });
      return changed ? touched({ bible }) : doc;
    }

    case 'REMOVE_BIBLE_ENTRY': {
      const bible = doc.bible.filter((e) => e.id !== cmd.entryId);
      return bible.length === doc.bible.length ? doc : touched({ bible });
    }
  }
}

// ── Statisztika ──────────────────────────────────────────────────────────────

export interface WritingStats {
  chapters: number;
  words: number;
  chars: number;
  readingMin: number;
}

/** A teljes dokumentum szó/karakter/olvasási-idő statisztikája (fejezetenként összegezve). */
export function writingStats(doc: WritingDoc): WritingStats {
  let words = 0;
  let chars = 0;
  for (const c of doc.chapters) {
    words += wordCount(c.body);
    chars += charCount(c.body);
  }
  return { chapters: doc.chapters.length, words, chars, readingMin: readingTimeMin(words) };
}

// ── AI-kontextus (MASTER §9: ki a szereplő · előző fejezet · stílus · terminológia) ──

function excerpt(md: string, max = 2000): string {
  return md.length <= max ? md : md.slice(0, max) + '…';
}

const byKind = (bible: BibleEntry[], kind: BibleEntryKind): string[] =>
  bible.filter((e) => e.kind === kind && e.name).map((e) => (e.description ? `${e.name}: ${e.description}` : e.name));

/**
 * Rétegzett, AI-olvasható kontextus egy fejezet írásához: a könyv-meta + az
 * AKTUÁLIS fejezet (kivonatolva) + az ELŐZŐ fejezet összefoglalója + a story
 * bible + (ha van) a Creator Memory `writing`-stílusa/terminológiája. A `memory`
 * a `@/lib/creatorMemory` `memoryContext(mem, 'writing')`-je.
 */
export function buildWritingContext(
  doc: WritingDoc,
  currentChapterId: string | null,
  memory?: CreatorMemory | null
): Record<string, unknown> {
  const idx = currentChapterId ? doc.chapters.findIndex((c) => c.id === currentChapterId) : -1;
  const current = idx >= 0 ? doc.chapters[idx] : undefined;
  const previous = idx > 0 ? doc.chapters[idx - 1] : undefined;
  const mem = memory ? memoryContext(memory, 'writing') : null;

  return {
    book: {
      title: doc.title,
      ...(doc.logline ? { logline: doc.logline } : {}),
      chapterCount: doc.chapters.length,
    },
    ...(current
      ? { currentChapter: { title: current.title, body: excerpt(current.body), words: wordCount(current.body) } }
      : {}),
    ...(previous ? { previousChapter: { title: previous.title, synopsis: previous.synopsis ?? '' } } : {}),
    bible: {
      characters: byKind(doc.bible, 'character'),
      locations: byKind(doc.bible, 'location'),
      research: byKind(doc.bible, 'research'),
      notes: byKind(doc.bible, 'note'),
    },
    ...(mem ? { creatorMemory: mem } : {}),
  };
}
