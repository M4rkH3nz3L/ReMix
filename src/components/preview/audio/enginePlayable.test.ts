/**
 * 🎧 Mikor játszhatja a motor az előnézetet (REFACTOR: az AudioLayer.tsx-ből kiemelve) — a
 * JELENLEGI viselkedést rögzíti: helyi forrás, támogatott keverés, hosszú forrás szakaszosan.
 */
import { engineCanPlay, longClipPlayable } from '@/components/preview/audio/enginePlayable';
import type { OfflineMixPlan } from '@/lib/offlineMix';

const segment = { ok: true, calls: 0 };
jest.mock('@/lib/longSource', () => ({
  isLongSource: (d: number | undefined) => (d ?? 0) > 600,
  canSegment: () => {
    segment.calls++;
    return segment.ok;
  },
}));

type MixClip = OfflineMixPlan['clips'][number];
const clip = (over: Partial<MixClip> = {}): MixClip =>
  ({ uri: 'file:///a.wav', sourceDuration: 30, speed: 1, reversed: false, pitch: 0, ...over }) as MixClip;
const plan = (clips: MixClip[], unsupported: OfflineMixPlan['unsupported'] = []): OfflineMixPlan =>
  ({ duration: 10, clips, unsupported }) as OfflineMixPlan;

beforeEach(() => {
  segment.ok = true;
  segment.calls = 0;
});

describe('longClipPlayable', () => {
  it('a rövid forrás mindig játszható — a szakaszos dekódolást meg sem kérdezi', () => {
    expect(longClipPlayable(clip())).toBe(true);
    expect(longClipPlayable(clip({ sourceDuration: undefined }))).toBe(true);
    expect(segment.calls).toBe(0);
  });

  it('a hosszú forrás csak szakaszos dekódolással és egész-ablakos feldolgozás nélkül', () => {
    expect(longClipPlayable(clip({ sourceDuration: 3600 }))).toBe(true);
    expect(longClipPlayable(clip({ sourceDuration: 3600, speed: 1.5 }))).toBe(false);
    expect(longClipPlayable(clip({ sourceDuration: 3600, reversed: true }))).toBe(false);
    segment.ok = false;
    expect(longClipPlayable(clip({ sourceDuration: 3600 }))).toBe(false);
  });
});

describe('engineCanPlay', () => {
  it('terv nélkül (nincs hang) a motor marad', () => {
    expect(engineCanPlay(null)).toBe(true);
  });

  it('csak helyi (file:) forrásokból és támogatott keverésből', () => {
    expect(engineCanPlay(plan([clip(), clip({ uri: 'file:///b.wav' })]))).toBe(true);
    expect(engineCanPlay(plan([clip(), clip({ uri: 'https://cdn/b.wav' })]))).toBe(false);
    expect(engineCanPlay(plan([clip()], ['x' as OfflineMixPlan['unsupported'][number]]))).toBe(false);
  });

  it('a hosszú forrás szakaszos dekódolás nélkül visszaesést kér', () => {
    segment.ok = false;
    expect(engineCanPlay(plan([clip({ sourceDuration: 3600 })]))).toBe(false);
  });
});
