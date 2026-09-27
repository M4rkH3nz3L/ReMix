import {
  PODCAST_REPURPOSE,
  audiogramBars,
  buildPodcastRss,
  chaptersToTimestamps,
  fillerRanges,
  formatTimestamp,
  silenceGaps,
  tightenSilencePlan,
} from '@/lib/podcast';
import { templateRequiresPro } from '@/lib/workflowTemplate';

describe('podcast — silence', () => {
  const speech = [
    { start: 0, end: 2 },
    { start: 5, end: 7 }, // 3 mp rés előtte
    { start: 7.2, end: 9 }, // 0.2 mp rés (kicsi)
  ];
  it('silenceGaps a minGap fölötti réseket adja (záró csenddel)', () => {
    const gaps = silenceGaps(speech, 12, 0.5);
    expect(gaps).toEqual([
      { start: 2, end: 5 }, // 3 mp
      { start: 9, end: 12 }, // záró csend
    ]);
  });
  it('tightenSilencePlan a keepSec fölötti csendet spórolja', () => {
    const plan = tightenSilencePlan(speech, 12, { keepSec: 0.3 });
    // (3-0.3) + (3-0.3) = 5.4
    expect(plan.removedSec).toBeCloseTo(5.4);
    expect(plan.keep).toHaveLength(3);
  });
});

describe('podcast — filler-szavak', () => {
  it('a töltelékszavak tartományait adja (írásjel-tűrően)', () => {
    const ranges = fillerRanges([
      { word: 'szóval', start: 0, end: 0.4 },
      { word: 'öö', start: 0.4, end: 0.6 },
      { word: 'like', start: 1, end: 1.2 },
      { word: 'fontos', start: 1.2, end: 1.6 },
      { word: 'hát,', start: 2, end: 2.2 },
    ]);
    expect(ranges).toEqual([
      { start: 0.4, end: 0.6 },
      { start: 1, end: 1.2 },
      { start: 2, end: 2.2 },
    ]);
  });
});

describe('podcast — fejezetek + timestamp', () => {
  it('formatTimestamp MM:SS és H:MM:SS', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(150)).toBe('02:30');
    expect(formatTimestamp(3661)).toBe('1:01:01');
  });
  it('chaptersToTimestamps rendezve', () => {
    const out = chaptersToTimestamps([
      { title: 'Téma', startSec: 150 },
      { title: 'Intro', startSec: 0 },
    ]);
    expect(out).toBe('00:00 Intro\n02:30 Téma');
  });
});

describe('podcast — audiogram', () => {
  it('a csúcsokat N sávra ritkítja + 0–1-re normalizálja', () => {
    const bars = audiogramBars([0, 0, 4, 4, 2, 2], 3);
    expect(bars).toHaveLength(3);
    expect(Math.max(...bars)).toBe(1); // normalizált
    expect(bars[1]).toBe(1); // a 4,4 bucket a legerősebb
  });
  it('üres bemenet → üres', () => {
    expect(audiogramBars([], 10)).toEqual([]);
  });
});

describe('podcast — RSS', () => {
  it('érvényes RSS 2.0 + iTunes + escape', () => {
    const xml = buildPodcastRss(
      { title: 'Show & Tell', description: 'leírás', link: 'https://x.hu', author: 'H3nz3L' },
      [{ title: 'Ep 1', description: 'első', audioUrl: 'https://x.hu/1.mp3', durationSec: 3661, pubDate: 'Mon, 27 Sep 2026 10:00:00 GMT' }]
    );
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('xmlns:itunes');
    expect(xml).toContain('<title>Show &amp; Tell</title>'); // escape
    expect(xml).toContain('<itunes:duration>01:01:01</itunes:duration>');
    expect(xml).toContain('<enclosure url="https://x.hu/1.mp3"');
  });
});

describe('podcast — repurpose workflow', () => {
  it('a „1 felvétel → sok" sablon lépései + Pro-igény', () => {
    expect(PODCAST_REPURPOSE.steps.map((s) => s.kind)).toEqual([
      'transcript', 'chapters', 'highlights', 'shorts', 'quote-cards', 'audiogram', 'show-notes', 'social-posts',
    ]);
    expect(templateRequiresPro(PODCAST_REPURPOSE)).toBe(true);
  });
});
