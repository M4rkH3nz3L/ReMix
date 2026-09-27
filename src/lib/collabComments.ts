/**
 * 👥 Kreatív kollaboráció — komment + jóváhagyás mag (E-Collab — MASTER §19). A
 * live-presence/kurzor a [collabLive.ts](./collabLive)-ban van; ez a HORGONYZOTT
 * komment (timecode/frame/audio/design) + mentions + a jóváhagyási munkafolyamat
 * (reviewer/producer) TISZTA modellje.
 *
 * Expo-mentes, immutábilis, determinisztikus (`makeId`/`now` injektálva).
 */

export type CommentAnchor =
  | { kind: 'timecode'; sec: number }
  | { kind: 'frame'; frame: number }
  | { kind: 'audio'; sec: number; track?: string }
  | { kind: 'design'; x: number; y: number } // vászon-normalizált 0–1
  | { kind: 'general' };

export interface Comment {
  id: string;
  authorId: string;
  authorName?: string;
  body: string;
  anchor: CommentAnchor;
  /** a body-ból kinyert @-handle-ök */
  mentions: string[];
  /** szál: melyik kommentre válasz (gyökér = nincs) */
  parentId?: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentThread {
  comments: Comment[];
}

export function emptyThread(): CommentThread {
  return { comments: [] };
}

/** @-mention-ök kinyerése a szövegből (kisbetűs handle-ök, egyediek, sorrendben). */
export function extractMentions(body: string): string[] {
  const out: string[] = [];
  const re = /@([a-z0-9_.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const h = m[1].toLowerCase();
    if (!out.includes(h)) {
      out.push(h);
    }
  }
  return out;
}

export interface CommentInput {
  authorId: string;
  authorName?: string;
  body: string;
  anchor?: CommentAnchor;
  parentId?: string;
}

export function addComment(thread: CommentThread, input: CommentInput, makeId: () => string, now: string): CommentThread {
  const body = input.body.trim();
  if (!body) {
    return thread;
  }
  const comment: Comment = {
    id: makeId(),
    authorId: input.authorId,
    ...(input.authorName ? { authorName: input.authorName } : {}),
    body,
    anchor: input.anchor ?? { kind: 'general' },
    mentions: extractMentions(body),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    resolved: false,
    createdAt: now,
    updatedAt: now,
  };
  return { comments: [...thread.comments, comment] };
}

function mapComment(thread: CommentThread, id: string, fn: (c: Comment) => Comment): CommentThread {
  let changed = false;
  const comments = thread.comments.map((c) => {
    if (c.id !== id) {
      return c;
    }
    changed = true;
    return fn(c);
  });
  return changed ? { comments } : thread;
}

export function resolveComment(thread: CommentThread, id: string, now: string): CommentThread {
  return mapComment(thread, id, (c) => ({ ...c, resolved: true, updatedAt: now }));
}
export function reopenComment(thread: CommentThread, id: string, now: string): CommentThread {
  return mapComment(thread, id, (c) => ({ ...c, resolved: false, updatedAt: now }));
}

export function removeComment(thread: CommentThread, id: string): CommentThread {
  // a kommentet ÉS a rá adott válaszokat is törli
  const comments = thread.comments.filter((c) => c.id !== id && c.parentId !== id);
  return comments.length === thread.comments.length ? thread : { comments };
}

// ── Lekérdezések ──────────────────────────────────────────────────────────────

export function roots(thread: CommentThread): Comment[] {
  return thread.comments.filter((c) => !c.parentId);
}
export function replies(thread: CommentThread, id: string): Comment[] {
  return thread.comments.filter((c) => c.parentId === id);
}
export function unresolved(thread: CommentThread): Comment[] {
  return thread.comments.filter((c) => !c.resolved);
}
export function mentionsOf(thread: CommentThread, handle: string): Comment[] {
  const h = handle.toLowerCase().replace(/^@/, '');
  return thread.comments.filter((c) => c.mentions.includes(h));
}

/** Idő-alapú horgonyú kommentek egy `[from, to]` (mp) ablakban (timecode + audio). */
export function commentsInTimeRange(thread: CommentThread, from: number, to: number): Comment[] {
  return thread.comments
    .filter((c) => (c.anchor.kind === 'timecode' || c.anchor.kind === 'audio') && c.anchor.sec >= from && c.anchor.sec <= to)
    .sort((a, b) => (a.anchor as { sec: number }).sec - (b.anchor as { sec: number }).sec);
}

// ── Jóváhagyási munkafolyamat ─────────────────────────────────────────────────

export type ReviewRole = 'owner' | 'editor' | 'reviewer' | 'producer' | 'viewer';

export type ReviewDecision = 'pending' | 'approved' | 'changes';
export type ApprovalStatus = 'draft' | 'in-review' | 'changes-requested' | 'approved';

export interface ApprovalState {
  status: ApprovalStatus;
  reviewers: string[];
  decisions: Record<string, ReviewDecision>;
}

export function emptyApproval(): ApprovalState {
  return { status: 'draft', reviewers: [], decisions: {} };
}

/** A státusz a döntésekből: bármely „changes" → changes-requested; mind approved → approved. */
function deriveStatus(reviewers: string[], decisions: Record<string, ReviewDecision>): ApprovalStatus {
  if (reviewers.length === 0) {
    return 'draft';
  }
  if (reviewers.some((r) => decisions[r] === 'changes')) {
    return 'changes-requested';
  }
  if (reviewers.every((r) => decisions[r] === 'approved')) {
    return 'approved';
  }
  return 'in-review';
}

/** Review kérése a megadott reviewer-öktől (a döntéseik pending-re állnak). */
export function requestReview(state: ApprovalState, reviewers: string[]): ApprovalState {
  const uniq = [...new Set(reviewers)];
  const decisions: Record<string, ReviewDecision> = {};
  for (const r of uniq) {
    decisions[r] = state.decisions[r] ?? 'pending';
  }
  return { reviewers: uniq, decisions, status: deriveStatus(uniq, decisions) };
}

/** Egy reviewer döntése (approved / changes / pending) — a státusz újraszámol. */
export function submitDecision(state: ApprovalState, reviewer: string, decision: ReviewDecision): ApprovalState {
  if (!state.reviewers.includes(reviewer)) {
    return state;
  }
  const decisions = { ...state.decisions, [reviewer]: decision };
  return { ...state, decisions, status: deriveStatus(state.reviewers, decisions) };
}
