import { localRenderGaps } from '@/lib/renderParity';
import type { Project } from '@/types/project';

// 🔤 VIDEO-PROD E2: iOS-en a szöveg csak a szöveg-overlay-t nem tudó buildnél rés; az idő-függő szöveg mindig rés
const text = (extra: Record<string, unknown> = {}) => ({ kind: 'text', id: 't', start: 0, duration: 2, text: 'Hi', color: '#fff', backgroundColor: null, fontSize: 12, fontWeight: 'bold', position: { x: 0.5, y: 0.5 }, ...extra });
const project = (clip: Record<string, unknown>) =>
  ({ id: 'p', name: 'p', aspectRatio: '9:16', fps: 30, assets: [], createdAt: '', updatedAt: '', schemaVersion: 10, tracks: [{ id: 't0', type: 'text', name: 'T', clips: [clip] }] }) as unknown as Project;

describe('szöveg a telefonos exportban — build-függő kapu', () => {
  it('iOS, régi build: a szöveg felhő-rés', () => {
    expect(localRenderGaps(project(text()), 'ios')).toEqual(['text']);
  });
  it('iOS, overlay-t tudó build: a statikus és a zárt képletű belépős szöveg nem rés', () => {
    expect(localRenderGaps(project(text()), 'ios', { iosTextOverlays: true })).toEqual([]);
    expect(localRenderGaps(project(text({ animation: 'slide' })), 'ios', { iosTextOverlays: true })).toEqual([]);
  });
  it('az idő-függő szöveg (gépelés, szó-mozgás, kulcskocka) mindenhol rés', () => {
    for (const extra of [{ animation: 'typewriter' }, { textMotion: { preset: 'typeOn', by: 'char' } }, { keyframes: { x: [{ time: 0, value: 0, easing: 'linear' }] } }]) {
      expect(localRenderGaps(project(text(extra)), 'ios', { iosTextOverlays: true })).toEqual(['text']);
      expect(localRenderGaps(project(text(extra)), 'android')).toEqual(['text']);
    }
  });
});
