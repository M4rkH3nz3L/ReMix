import type { WorkflowTemplate } from '@/lib/workflowTemplate';

/**
 * 🎙️ Podcast Studio mag (S-PODCAST — MASTER §10) — a felvétel-utómunka és a
 * disztribúció TISZTA logikája: silence/filler-vágás terv (átiratból), fejezetek +
 * timestampek, audiogram-sávok (waveformból), RSS-feed XML, és az „1 felvétel →
 * sok" repurpose workflow-sablon. A nehéz DSP a workeré; ez a determinisztikus mag.
 */

export interface Segment {
  start: number;
  end: number;
}

// ── Silence-vágás ─────────────────────────────────────────────────────────────

/** A beszéd-szegmensek közti (és a vezető/záró) csend-rések a `minGapSec` fölött. */
export function silenceGaps(speech: Segment[], duration: number, minGapSec = 0.5): Segment[] {
  const sorted = [...speech].sort((a, b) => a.start - b.start);
  const gaps: Segment[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start - cursor >= minGapSec) {
      gaps.push({ start: cursor, end: s.start });
    }
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor >= minGapSec) {
    gaps.push({ start: cursor, end: duration });
  }
  return gaps;
}

export interface SilencePlan {
  /** a megtartandó beszéd-szegmensek */
  keep: Segment[];
  /** a levágott (a `keepSec` fölötti) csend összideje */
  removedSec: number;
}

/**
 * Csend-tömörítési terv: a beszédet megtartja, a réseket `keepSec`-re vágja.
 * @returns a megtartott szegmensek + a megspórolt idő.
 */
export function tightenSilencePlan(
  speech: Segment[],
  duration: number,
  opts: { minGapSec?: number; keepSec?: number } = {}
): SilencePlan {
  const keepSec = opts.keepSec ?? 0.3;
  const gaps = silenceGaps(speech, duration, opts.minGapSec ?? 0.5);
  const removedSec = gaps.reduce((s, g) => s + Math.max(0, g.end - g.start - keepSec), 0);
  const keep = [...speech].sort((a, b) => a.start - b.start);
  return { keep, removedSec: Math.round(removedSec * 100) / 100 };
}

// ── Filler-szó eltávolítás ────────────────────────────────────────────────────

export interface Word {
  word: string;
  start: number;
  end: number;
}

export const DEFAULT_FILLERS = ['um', 'uh', 'er', 'erm', 'hmm', 'like', 'öö', 'ööö', 'hát', 'ugye', 'izé', 'mondjuk'];

/** A töltelékszavak idő-tartományai (a szó-időzítésből), levágásra. */
export function fillerRanges(words: Word[], fillers: string[] = DEFAULT_FILLERS): Segment[] {
  const set = new Set(fillers.map((f) => f.toLowerCase()));
  const out: Segment[] = [];
  for (const w of words) {
    const clean = w.word.toLowerCase().replace(/[.,!?…]+$/, '').trim();
    if (set.has(clean)) {
      out.push({ start: w.start, end: w.end });
    }
  }
  return out;
}

// ── Fejezetek + timestampek ───────────────────────────────────────────────────

export interface Chapter {
  title: string;
  startSec: number;
}

export function sortChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.startSec - b.startSec);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** mp → „MM:SS" vagy „H:MM:SS" (YouTube-fejezet stílus). */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
}

/** A fejezetek YouTube-stílusú timestamp-listája („00:00 Intro"). */
export function chaptersToTimestamps(chapters: Chapter[]): string {
  return sortChapters(chapters)
    .map((c) => `${formatTimestamp(c.startSec)} ${c.title}`)
    .join('\n');
}

// ── Audiogram-sávok ───────────────────────────────────────────────────────────

/** A waveform-csúcsokat `bars` sávra ritkítja (átlagolva) + 0–1-re normalizálja. */
export function audiogramBars(peaks: number[], bars: number): number[] {
  if (bars <= 0 || peaks.length === 0) {
    return [];
  }
  const out: number[] = [];
  const bucket = peaks.length / bars;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * bucket);
    const to = Math.max(from + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    let n = 0;
    for (let j = from; j < to && j < peaks.length; j++) {
      sum += Math.abs(peaks[j]);
      n++;
    }
    out.push(n ? sum / n : 0);
  }
  const max = Math.max(...out, 1e-9);
  return out.map((v) => Math.round((v / max) * 1000) / 1000);
}

// ── RSS-feed ──────────────────────────────────────────────────────────────────

export interface PodcastFeed {
  title: string;
  description: string;
  link: string;
  author?: string;
  imageUrl?: string;
  language?: string;
}

export interface PodcastEpisode {
  title: string;
  description: string;
  audioUrl: string;
  durationSec: number;
  /** RFC-822 vagy ISO dátum (a hívó adja — nincs rejtett `Date.now`) */
  pubDate: string;
  guid?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** Podcast RSS 2.0 (iTunes-tagekkel) az epizódokból — tiszta XML-string. */
export function buildPodcastRss(feed: PodcastFeed, episodes: PodcastEpisode[]): string {
  const items = episodes
    .map((e) =>
      [
        '    <item>',
        `      <title>${escapeXml(e.title)}</title>`,
        `      <description>${escapeXml(e.description)}</description>`,
        `      <enclosure url="${escapeXml(e.audioUrl)}" type="audio/mpeg" />`,
        `      <guid>${escapeXml(e.guid ?? e.audioUrl)}</guid>`,
        `      <pubDate>${escapeXml(e.pubDate)}</pubDate>`,
        `      <itunes:duration>${hms(e.durationSec)}</itunes:duration>`,
        '    </item>',
      ].join('\n')
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
    '  <channel>',
    `    <title>${escapeXml(feed.title)}</title>`,
    `    <description>${escapeXml(feed.description)}</description>`,
    `    <link>${escapeXml(feed.link)}</link>`,
    `    <language>${escapeXml(feed.language ?? 'hu')}</language>`,
    ...(feed.author ? [`    <itunes:author>${escapeXml(feed.author)}</itunes:author>`] : []),
    ...(feed.imageUrl ? [`    <itunes:image href="${escapeXml(feed.imageUrl)}" />`] : []),
    items,
    '  </channel>',
    '</rss>',
  ].join('\n');
}

// ── „1 felvétel → sok" repurpose workflow-sablon ─────────────────────────────

export const PODCAST_REPURPOSE: WorkflowTemplate = {
  id: 'podcast-repurpose',
  name: 'Podcast → Sok tartalom',
  role: 'podcaster',
  steps: [
    { id: 'transcript', kind: 'transcript', label: 'workflowTpl.step.transcript', capability: 'autoCaption' },
    { id: 'chapters', kind: 'chapters', label: 'workflowTpl.step.chapters', capability: 'autoEdit' },
    { id: 'highlights', kind: 'highlights', label: 'workflowTpl.step.highlights', capability: 'autoEdit' },
    { id: 'shorts', kind: 'shorts', label: 'workflowTpl.step.shorts', capability: 'reframe' },
    { id: 'quotes', kind: 'quote-cards', label: 'workflowTpl.step.quotes' },
    { id: 'audiogram', kind: 'audiogram', label: 'workflowTpl.step.audiogram' },
    { id: 'shownotes', kind: 'show-notes', label: 'workflowTpl.step.shownotes', capability: 'autoEdit' },
    { id: 'social', kind: 'social-posts', label: 'workflowTpl.step.social', capability: 'autoEdit' },
  ],
};
