import {
  aspectValue,
  canvasMaxHeight,
  fitCanvas,
  flipFacing,
  formatGainDb,
  gainLevel,
  isDestErrorKey,
  levelWidth,
  nextSceneName,
  primaryCameraIdOf,
  projectWithFacing,
  rtmpDestinationInput,
  rtmpSubmitDisabled,
  sourceRect,
  startTitle,
} from '@/lib/liveStudioOps';
import { MAX_DB, MIN_DB } from '@/lib/liveMixer';
import type { LiveScene, LiveSource } from '@/types/live';
import type { Project } from '@/types/project';

const src = (id: string, kind: LiveSource['kind'], z: number, visible = true) =>
  ({ id, kind, label: id, visible, transform: { x: 0, y: 0, w: 1, h: 1, z } }) as LiveSource;
const scene = (sources: LiveSource[]) => ({ id: 's1', name: 'S', sources }) as LiveScene;

describe('liveStudioOps — a Live Studio számításai (REFACTOR-rögzítés)', () => {
  it('aspectValue: 9:16 és 1:1 felismerve, minden más (és hiány) 16:9', () => {
    expect(aspectValue('9:16')).toBe(9 / 16);
    expect(aspectValue('1:1')).toBe(1);
    expect(aspectValue('16:9')).toBe(16 / 9);
    expect(aspectValue('4:5')).toBe(16 / 9);
    expect(aspectValue(undefined)).toBe(16 / 9);
  });

  it('fitCanvas: ha belefér, a teljes szélesség; ha túl magas, a magasságra vág arányosan', () => {
    expect(fitCanvas(320, 16 / 9, 500)).toEqual({ w: 320, height: 180 });
    expect(fitCanvas(400, 9 / 16, 300)).toEqual({ w: 300 * (9 / 16), height: 300 });
    // pontosan a határon nem vág
    expect(fitCanvas(100, 1, 100)).toEqual({ w: 100, height: 100 });
  });

  it('canvasMaxHeight: tableten 70 %, telefonon 42 %', () => {
    expect(canvasMaxHeight(true, 1000)).toBe(700);
    expect(canvasMaxHeight(false, 1000)).toBe(1000 * 0.42);
  });

  it('sourceRect: képpont-doboz a vásznon, legalább 28 × 22 pt, ebben a kulcssorrendben', () => {
    const r = sourceRect({ x: 0.5, y: 0.25, w: 0.5, h: 0.5, z: 0 }, 200, 100);
    expect(r).toEqual({ left: 100, top: 25, width: 100, height: 50 });
    expect(Object.keys(r)).toEqual(['left', 'top', 'width', 'height']);
    expect(sourceRect({ x: 0, y: 0, w: 0.01, h: 0.01, z: 0 }, 200, 100)).toEqual({ left: 0, top: 0, width: 28, height: 22 });
  });

  it('primaryCameraIdOf: z-sorrendben az első LÁTHATÓ kamera; nincs jelenet / kamera → null', () => {
    expect(primaryCameraIdOf(undefined)).toBeNull();
    expect(primaryCameraIdOf(scene([src('t', 'text', 0)]))).toBeNull();
    expect(primaryCameraIdOf(scene([src('c2', 'camera', 5), src('c1', 'camera', 1)]))).toBe('c1');
    expect(primaryCameraIdOf(scene([src('c1', 'camera', 1, false), src('c2', 'camera', 5)]))).toBe('c2');
  });

  it('nextSceneName: a darabszám + 1', () => {
    expect(nextSceneName(0)).toBe('Scene 1');
    expect(nextSceneName(2)).toBe('Scene 3');
  });

  it('startTitle: vágott vázlat, üresen a doc címe (vágás nélkül), 120 karakterre vágva', () => {
    expect(startTitle('  Hello  ', 'Doc')).toBe('Hello');
    expect(startTitle('   ', ' Doc ')).toBe(' Doc ');
    expect(startTitle('x'.repeat(130), 'Doc')).toHaveLength(120);
    expect(startTitle('', 'y'.repeat(130))).toHaveLength(120);
  });

  it('projectWithFacing: a live-doc kamera-iránya beíródik, live nélkül ugyanaz az objektum', () => {
    const p = { id: 'p', live: { title: 'L' } } as unknown as Project;
    const out = projectWithFacing(p, 'back');
    expect(out).not.toBe(p);
    expect(out.live).toEqual({ title: 'L', cameraFacing: 'back' });
    expect(p.live).toEqual({ title: 'L' });
    const bare = { id: 'p' } as unknown as Project;
    expect(projectWithFacing(bare, 'front')).toBe(bare);
  });

  it('flipFacing: front ↔ back', () => {
    expect(flipFacing('front')).toBe('back');
    expect(flipFacing('back')).toBe('front');
  });

  it('gainLevel + levelWidth: a sáv 0–100 %-ra vágva, a nyers szint nem vágott', () => {
    expect(gainLevel(MIN_DB, MIN_DB, MAX_DB)).toBe(0);
    expect(gainLevel(MAX_DB, MIN_DB, MAX_DB)).toBe(1);
    expect(gainLevel(MAX_DB + 10, MIN_DB, MAX_DB)).toBeGreaterThan(1);
    expect(levelWidth(0.5)).toBe('50%');
    expect(levelWidth(-0.2)).toBe('0%');
    expect(levelWidth(1.7)).toBe('100%');
  });

  it('formatGainDb: pozitív → „+” szöveg, nulla és negatív szám marad', () => {
    expect(formatGainDb(3)).toBe('+3');
    expect(formatGainDb(0)).toBe(0);
    expect(formatGainDb(-6)).toBe(-6);
  });

  it('rtmpSubmitDisabled: üres (csak szóköz) URL vagy kulcs → tiltva', () => {
    expect(rtmpSubmitDisabled('', 'k')).toBe(true);
    expect(rtmpSubmitDisabled('rtmp://x', '  ')).toBe(true);
    expect(rtmpSubmitDisabled(' rtmp://x ', ' k ')).toBe(false);
  });

  it('rtmpDestinationInput: vágott mezők, üres címke → RTMP, custom + bekapcsolva, ebben a kulcssorrendben', () => {
    const input = rtmpDestinationInput('  ', ' rtmp://a/live ', ' key ');
    expect(input).toEqual({ platform: 'custom', label: 'RTMP', rtmpUrl: 'rtmp://a/live', streamKey: 'key', enabled: true });
    expect(Object.keys(input)).toEqual(['platform', 'label', 'rtmpUrl', 'streamKey', 'enabled']);
    expect(rtmpDestinationInput(' YT ', 'u', 'k').label).toBe('YT');
  });

  it('isDestErrorKey: csak a live.dest. előtagú üzenet i18n-kulcs', () => {
    expect(isDestErrorKey('live.dest.badUrl')).toBe(true);
    expect(isDestErrorKey('network down')).toBe(false);
    expect(isDestErrorKey('xlive.dest.')).toBe(false);
  });
});
