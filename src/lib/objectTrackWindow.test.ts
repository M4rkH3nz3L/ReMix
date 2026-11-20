import { objectTrackWindow } from '@/lib/objectTrackWindow';
import type { Project } from '@/types/project';

const video = (over: Record<string, unknown> = {}) => ({ kind: 'video', id: 'v', uri: 'file:///v.mp4', start: 0, duration: 20, trimIn: 0, speed: 1, ...over });
const project = (videoClips: unknown[]) =>
  ({ id: 'p', name: 'P', aspectRatio: '9:16', tracks: [{ id: 'tv', type: 'video', clips: videoClips }] }) as unknown as Project;
const clip = { start: 2, duration: 5 };

describe('objectTrackWindow — az objektum-követés indítási ablaka', () => {
  it('nincs videó a lejátszófej alatt → needVideo (üres sáv és nem-videó klip is)', () => {
    expect(objectTrackWindow(project([]), clip, 3)).toEqual({ ok: false, reason: 'needVideo' });
    expect(objectTrackWindow(project([{ kind: 'image', id: 'i', start: 0, duration: 10 }]), clip, 3)).toEqual({ ok: false, reason: 'needVideo' });
  });

  it('a lejátszófej a klipen kívül → playheadOnClip; a kezdet benne, a vég (félig nyitott) már nincs', () => {
    const p = project([video()]);
    expect(objectTrackWindow(p, clip, 1.99)).toEqual({ ok: false, reason: 'playheadOnClip' });
    expect(objectTrackWindow(p, clip, 7)).toEqual({ ok: false, reason: 'playheadOnClip' });
    expect(objectTrackWindow(p, clip, 2).ok).toBe(true);
  });

  it('a videó-ellenőrzés megelőzi a klip-ellenőrzést', () => {
    expect(objectTrackWindow(project([video({ start: 10 })]), clip, 8)).toEqual({ ok: false, reason: 'needVideo' });
  });

  it('a hossz: min(klip vége, videó vége, lejátszófej + 15 s) − lejátszófej', () => {
    const long = { start: 0, duration: 100 };
    expect(objectTrackWindow(project([video({ duration: 200 })]), long, 10)).toMatchObject({ ok: true, durTl: 15 });
    expect(objectTrackWindow(project([video({ duration: 12 })]), long, 10)).toMatchObject({ ok: true, durTl: 2 });
    expect(objectTrackWindow(project([video()]), clip, 3)).toMatchObject({ ok: true, durTl: 4 });
  });

  it('0,5 s alatt tooShort; pontosan 0,5 s még elég', () => {
    expect(objectTrackWindow(project([video()]), clip, 6.6)).toEqual({ ok: false, reason: 'tooShort' });
    expect(objectTrackWindow(project([video()]), clip, 6.5)).toMatchObject({ ok: true, durTl: 0.5 });
  });

  it('átfedő videóknál a legkésőbb kezdődő a követés forrása', () => {
    const w = objectTrackWindow(project([video({ id: 'a' }), video({ id: 'b', start: 1, uri: 'file:///b.mp4' })]), clip, 3);
    expect(w.ok && w.video.id).toBe('b');
  });
});
