/**
 * 💻 Code Studio diff/patch mag (S-CODE — MASTER §11) — a „Git/diff" és az AI-
 * workflow „DIFF → APPROVE → APPLY" magja: sor-alapú LCS-diff, unified-diff
 * formázás, parse és biztonságos alkalmazás (pattern-illesztéssel, konfliktus-
 * jelzéssel). A meglévő AI-command bus (aiCommands) mintáját követi: az AI
 * javaslata DIFF, amit a user JÓVÁHAGY, majd EZ alkalmazza.
 *
 * Tiszta, expo-mentes, determinisztikus — teljesen tesztelhető.
 */

export type DiffOpKind = 'equal' | 'add' | 'remove';

export interface DiffLine {
  kind: DiffOpKind;
  text: string;
}

const splitLines = (s: string): string[] => s.split('\n');

/**
 * Sor-alapú diff (LCS): az `a`→`b` átalakítás műveletei sorrendben (equal/remove
 * az `a`-ból, add a `b`-ből).
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = splitLines(a);
  const B = splitLines(b);
  const n = A.length;
  const m = B.length;
  // LCS-hossz tábla
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: 'equal', text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'remove', text: A[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: B[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: 'remove', text: A[i++] });
  }
  while (j < m) {
    out.push({ kind: 'add', text: B[j++] });
  }
  return out;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(diff: DiffLine[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const d of diff) {
    if (d.kind === 'add') {
      additions++;
    } else if (d.kind === 'remove') {
      deletions++;
    }
  }
  return { additions, deletions };
}

// ── Hunk-építés + unified-diff formázás ──────────────────────────────────────

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** A teljes diffből hunk-ok `context` környező egyező sorral, a közelieket összevonva. */
export function buildHunks(diff: DiffLine[], context = 3): Hunk[] {
  // futó sor-számok (1-alapú) minden diff-elemhez
  const tagged = diff.map((d) => ({ d, oldNo: 0, newNo: 0 }));
  let oldNo = 0;
  let newNo = 0;
  for (const t of tagged) {
    if (t.d.kind === 'equal') {
      t.oldNo = ++oldNo;
      t.newNo = ++newNo;
    } else if (t.d.kind === 'remove') {
      t.oldNo = ++oldNo;
      t.newNo = newNo;
    } else {
      t.oldNo = oldNo;
      t.newNo = ++newNo;
    }
  }

  const changeIdx = tagged.map((t, i) => (t.d.kind === 'equal' ? -1 : i)).filter((i) => i >= 0);
  if (changeIdx.length === 0) {
    return [];
  }

  // változás-csoportok, amiket max 2*context egyező sor választ el → összevonás
  const groups: [number, number][] = [];
  let gs = changeIdx[0];
  let ge = changeIdx[0];
  for (let k = 1; k < changeIdx.length; k++) {
    if (changeIdx[k] - ge <= 2 * context + 1) {
      ge = changeIdx[k];
    } else {
      groups.push([gs, ge]);
      gs = ge = changeIdx[k];
    }
  }
  groups.push([gs, ge]);

  return groups.map(([s, e]) => {
    const start = Math.max(0, s - context);
    const end = Math.min(diff.length - 1, e + context);
    const slice = tagged.slice(start, end + 1);
    const lines = slice.map((t) => t.d);
    const oldCount = lines.filter((l) => l.kind !== 'add').length;
    const newCount = lines.filter((l) => l.kind !== 'remove').length;
    // a hunk kezdő sor-számai (az első sor előtti állapotból)
    const first = slice[0];
    const oldStart = first.d.kind === 'add' ? first.oldNo + 1 : first.oldNo;
    const newStart = first.d.kind === 'remove' ? first.newNo + 1 : first.newNo;
    return { oldStart: oldCount === 0 ? oldStart - 1 : oldStart, oldLines: oldCount, newStart: newCount === 0 ? newStart - 1 : newStart, newLines: newCount, lines };
  });
}

const PREFIX: Record<DiffOpKind, string> = { equal: ' ', add: '+', remove: '-' };

export interface FormatOptions {
  context?: number;
  fromFile?: string;
  toFile?: string;
}

/** Unified-diff szöveg (`--- / +++ / @@` fejléc + prefixelt sorok). */
export function formatUnifiedDiff(a: string, b: string, opts: FormatOptions = {}): string {
  const hunks = buildHunks(diffLines(a, b), opts.context ?? 3);
  if (hunks.length === 0) {
    return '';
  }
  const lines: string[] = [`--- ${opts.fromFile ?? 'a'}`, `+++ ${opts.toFile ?? 'b'}`];
  for (const h of hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      lines.push(PREFIX[l.kind] + l.text);
    }
  }
  return lines.join('\n');
}

// ── Parse + alkalmazás ───────────────────────────────────────────────────────

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Unified-diff szöveg → hunk-ok. A `---`/`+++` fejléc-sorokat kihagyja. */
export function parseUnifiedDiff(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      current = {
        oldStart: parseInt(header[1], 10),
        oldLines: header[2] ? parseInt(header[2], 10) : 1,
        newStart: parseInt(header[3], 10),
        newLines: header[4] ? parseInt(header[4], 10) : 1,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      continue;
    }
    const p = raw[0];
    if (p === ' ') {
      current.lines.push({ kind: 'equal', text: raw.slice(1) });
    } else if (p === '+') {
      current.lines.push({ kind: 'add', text: raw.slice(1) });
    } else if (p === '-') {
      current.lines.push({ kind: 'remove', text: raw.slice(1) });
    }
    // egyéb sorok (pl. üres, "\ No newline") kihagyva
  }
  return hunks;
}

export interface ApplyConflict {
  hunkIndex: number;
  expected: string[];
  detail: string;
}

export interface ApplyResult {
  ok: boolean;
  result: string;
  conflicts: ApplyConflict[];
}

/**
 * Patch alkalmazása a forrásra. A hunk „horgonyát" (egyező + törlendő sorok) a
 * forrásban KERESI a jelenlegi pozíciótól — így a sor-szám eltérésekre robusztus
 * (mint a `patch`). Ha egy horgony nem található, KONFLIKTUST jelez, és a forrást
 * VÁLTOZATLANUL adja vissza (nincs részleges, sérült alkalmazás).
 */
export function applyUnifiedDiff(source: string, patch: string): ApplyResult {
  const hunks = parseUnifiedDiff(patch);
  const src = splitLines(source);
  const out: string[] = [];
  const conflicts: ApplyConflict[] = [];
  let idx = 0;

  hunks.forEach((hunk, hi) => {
    const anchor = hunk.lines.filter((l) => l.kind !== 'add').map((l) => l.text);
    // horgony keresése a jelenlegi pozíciótól
    let pos = -1;
    for (let p = idx; p + anchor.length <= src.length; p++) {
      let match = true;
      for (let k = 0; k < anchor.length; k++) {
        if (src[p + k] !== anchor[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        pos = p;
        break;
      }
    }
    if (pos === -1) {
      conflicts.push({ hunkIndex: hi, expected: anchor, detail: 'anchor_not_found' });
      return;
    }
    // a horgony elé eső sorok átmásolása
    for (let p = idx; p < pos; p++) {
      out.push(src[p]);
    }
    // a hunk alkalmazása
    let sp = pos;
    for (const l of hunk.lines) {
      if (l.kind === 'equal') {
        out.push(src[sp++]);
      } else if (l.kind === 'remove') {
        sp++; // kihagyás (törlés)
      } else {
        out.push(l.text); // hozzáadás
      }
    }
    idx = sp;
  });

  if (conflicts.length > 0) {
    return { ok: false, result: source, conflicts };
  }
  // a maradék forrás átmásolása
  for (let p = idx; p < src.length; p++) {
    out.push(src[p]);
  }
  return { ok: true, result: out.join('\n'), conflicts: [] };
}
