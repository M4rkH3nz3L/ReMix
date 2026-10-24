import {
  deviceTextClips,
  deviceTextOverlaySpecs,
  hasUnsupportedTextClips,
  textClipUnsupportedOnDevice,
} from '@/lib/overlayPlan';
import type { Project, TextClip, Track } from '@/types/project';

/**
 * 🖼️ Overlay-terv (Android szöveg-render): mely klipek vihetők eszközre, és
 * milyen animáció-paraméterekkel — a preview görbéinek natív újrajátszásához.
 */

function text(partial: Partial<TextClip> = {}): TextClip {
  return {
    kind: 'text',
    id: 'tx',
    start: 1,
    duration: 2,
    text: 'Felirat',
    color: '#fff',
    backgroundColor: null,
    fontSize: 5,
    fontWeight: 'bold',
    position: { x: 0.5, y: 0.78 },
    animation: 'pop',
    stylePreset: 'bubble',
    ...partial,
  };
}

function project(clips: TextClip[]): Project {
  const track: Track = { id: 't', type: 'captions', name: 'C', clips };
  return {
    id: 'p',
    name: 'T',
    aspectRatio: '9:16',
    tracks: [track],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

describe('textClipUnsupportedOnDevice', () => {
  it('a zárt képletű belépők (pop/fade/slide/pulse/shake/none) vihetők', () => {
    for (const a of ['pop', 'fade', 'slide', 'pulse', 'shake', undefined] as const) {
      expect(textClipUnsupportedOnDevice(text({ animation: a as TextClip['animation'] }))).toBe(false);
    }
  });

  it('idő-függő tartalom (typewriter/karaoke/textMotion/kulcskocka) nem vihető', () => {
    expect(textClipUnsupportedOnDevice(text({ animation: 'typewriter' }))).toBe(true);
    expect(textClipUnsupportedOnDevice(text({ animation: 'karaoke' }))).toBe(true);
    expect(textClipUnsupportedOnDevice(text({ textMotion: { preset: 'reveal' } as never }))).toBe(true);
    expect(textClipUnsupportedOnDevice(text({ keyframes: { x: [{ t: 0, v: 0.2 }] } as never }))).toBe(true);
  });
});

describe('deviceTextOverlaySpecs', () => {
  it('spec: idő-ablak + horgony + animáció; a slide/shake amplitúdó a vászonhoz normalizált', () => {
    const p = project([
      text({ id: 'a', animation: 'slide', start: 0.5, duration: 3 }),
      text({ id: 'b', animation: 'shake', position: { x: 0.3, y: 0.2 } }),
    ]);
    const specs = deviceTextOverlaySpecs(p, 812);
    expect(specs).toHaveLength(2);
    const slide = specs.find((s) => s.clipId === 'a')!;
    expect(slide.anim).toBe('slide');
    expect(slide.atSec).toBe(0.5);
    expect(slide.durationSec).toBe(3);
    expect(slide.ampNorm).toBeCloseTo(30 / 812, 6);
    const shake = specs.find((s) => s.clipId === 'b')!;
    expect(shake.ampNorm).toBeCloseTo(2 / 812, 6);
    expect(shake.anchorX).toBeCloseTo(0.3);
    expect(shake.anchorY).toBeCloseTo(0.2);
  });

  it('nem-animált/pop klipnél nincs eltolás-amplitúdó', () => {
    const specs = deviceTextOverlaySpecs(project([text({ animation: 'pop' })]), 812);
    expect(specs[0].anim).toBe('pop');
    expect(specs[0].ampNorm).toBe(0);
  });

  it('a nem vihető klip kimarad a specből, és jelzi a hasUnsupported', () => {
    const p = project([text({ id: 'ok' }), text({ id: 'tw', animation: 'typewriter' })]);
    expect(deviceTextClips(p).map((c) => c.id)).toEqual(['ok']);
    expect(hasUnsupportedTextClips(p)).toBe(true);
  });
});
