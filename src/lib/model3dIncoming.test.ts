import { incomingModelRoute } from '@/lib/model3dIncoming';

describe('incomingModelRoute', () => {
  it('a bejövő 3D-fájlt az import-útvonalra irányítja', () => {
    const p = 'file:///private/var/mobile/Containers/Data/Application/X/Documents/Inbox/Szék%201.glb';
    expect(incomingModelRoute(p)).toBe(`/import3d?uri=${encodeURIComponent(p)}`);
    expect(incomingModelRoute('file:///x/model.USDZ')).toMatch(/^\/import3d/);
  });

  it('minden mást békén hagy', () => {
    expect(incomingModelRoute('remix://editor/prj_1')).toBeNull();
    expect(incomingModelRoute('file:///x/video.mp4')).toBeNull();
    expect(incomingModelRoute('/studio')).toBeNull();
  });
});
