/**
 * 🧹 Export előtti TARTALOM-ellenőrzés (PRO-VIDEO-EDITOR.md D1) — pure.
 *
 * A `renderPreflight` a render-motor egészségét nézi; ez a projekt TARTALMÁT: ott
 * maradt sablon-helyőrző szöveg, üres szövegklip, offline (hiányzó) média, üres
 * projekt, néma kimenet. Nem tilt — figyelmeztet, a user dönt (az ExportPanel
 * listázza, koppintásra a klipre ugrik).
 */
import type { Project } from '@/types/project';

/**
 * A sablonok „ide írd…" jellegű sorai (i18n-kulcsok a `templates.*` alatt) — a hívó
 * MINDEN nyelven feloldja (a projekt más nyelvű UI-ból is jöhetett).
 */
export const TEMPLATE_PLACEHOLDER_KEYS: readonly string[] = [
  'templates.hook-cta.line1',
  'templates.three-tips.line1',
  'templates.three-tips.line2',
  'templates.three-tips.line3',
  'templates.storytime.line1',
  'templates.storytime.line2',
  'templates.product.line1',
  'templates.product.line2',
  'templates.quote.line0',
  'templates.quote.line1',
  'templates.pov.line0',
  'templates.pov.line1',
  'templates.listicle.line1',
  'templates.listicle.line2',
  'templates.listicle.line3',
  'templates.tutorial.line1',
  'templates.tutorial.line2',
  'templates.tutorial.line3',
];

export type ExportIssueCode = 'empty' | 'placeholderText' | 'emptyText' | 'missingMedia' | 'silent';

export interface ExportIssue {
  code: ExportIssueCode;
  /** a klip, amire a hiba vonatkozik (koppintásra oda ugrunk) */
  clipId?: string;
  /** a klip kezdete (mp) — a lejátszófej ide áll */
  start?: number;
  /** a szöveg / a média neve a megjelenítéshez */
  detail?: string;
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

export function exportLint(
  project: Project,
  opts: { placeholders?: readonly string[]; missingUris?: readonly string[] } = {}
): ExportIssue[] {
  const out: ExportIssue[] = [];
  const clips = project.tracks.flatMap((t) => t.clips);
  if (clips.length === 0) {
    return [{ code: 'empty' }];
  }
  const placeholders = new Set((opts.placeholders ?? []).map(norm).filter(Boolean));
  const missing = new Set(opts.missingUris ?? []);
  const missingSeen = new Set<string>();
  let hasSound = false;
  let hasMedia = false;
  for (const c of clips) {
    if (c.kind === 'text') {
      const text = norm(c.text);
      if (!text) {
        out.push({ code: 'emptyText', clipId: c.id, start: c.start });
      } else if (placeholders.has(text)) {
        out.push({ code: 'placeholderText', clipId: c.id, start: c.start, detail: c.text.trim() });
      }
    }
    if ('uri' in c && typeof c.uri === 'string') {
      if (c.kind === 'video' || c.kind === 'audio') hasMedia = true;
      if (missing.has(c.uri) && !missingSeen.has(c.uri)) {
        missingSeen.add(c.uri);
        out.push({ code: 'missingMedia', clipId: c.id, start: c.start, detail: c.uri.split('/').pop() });
      }
    }
    if ((c.kind === 'video' || c.kind === 'audio') && (c.volume ?? 1) > 0) {
      hasSound = true;
    }
  }
  // van videó/hang, de mindegyik némítva → a kimenet néma lesz
  if (hasMedia && !hasSound) {
    out.push({ code: 'silent' });
  }
  return out;
}
