/** 👥 useLiveCollab: megosztott, betöltött projektnél elindul (Hang Stúdióban is), nem megosztottnál nem; kilépéskor leáll; a kurzor ritkítva megy. */
import { act, create } from 'react-test-renderer';

import { useLiveCollab } from '@/hooks/useLiveCollab';
import { createEmptyProject } from '@/lib/projectUtils';
import { useCollabLive } from '@/store/collabLiveStore';
import { useEditorStore } from '@/store/editorStore';

jest.mock('@/store/collabLiveStore', () => {
  const state = { start: jest.fn(async () => {}), stop: jest.fn(), sendCursor: jest.fn() };
  return { useCollabLive: { getState: () => state } };
});

function Probe({ id, owner }: { id: string; owner: string | null }) {
  useLiveCollab(id, owner);
  return null;
}

describe('useLiveCollab', () => {
  beforeEach(() => jest.clearAllMocks());
  it('megosztott, betöltött projekt: start(id), a lejátszófej ritkítva megy, kilépéskor stop', async () => {
    const b = createEmptyProject('k', '9:16', undefined, 'audio');
    // a lejátszófej a projekt hosszára szorul — kell egy klip
    const p = { ...b, id: 'prj_c', tracks: b.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [{ kind: 'audio' as const, id: 'a', uri: 'file:///a.wav', label: 'a', start: 0, duration: 5, trimIn: 0, sourceDuration: 5, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' as const }] } : t)) };
    useEditorStore.getState().loadProject(p, []);
    let r!: ReturnType<typeof create>;
    await act(async () => {
      r = create(<Probe id="prj_c" owner="owner-1" />);
    });
    const s = useCollabLive.getState() as unknown as { start: jest.Mock; stop: jest.Mock; sendCursor: jest.Mock };
    expect(s.start).toHaveBeenCalledWith('prj_c');
    act(() => {
      useEditorStore.getState().setPlayhead(1);
      useEditorStore.getState().setPlayhead(1.01);
    });
    expect(s.sendCursor).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
    expect(s.stop).toHaveBeenCalled();
  });
  it('nem megosztott (nincs tulaj) vagy más projekt betöltve: nem indul', async () => {
    const p = { ...createEmptyProject('k', '9:16', undefined, 'audio'), id: 'prj_d' };
    useEditorStore.getState().loadProject(p, []);
    await act(async () => {
      create(<Probe id="prj_d" owner={null} />);
      create(<Probe id="prj_x" owner="o" />);
    });
    expect((useCollabLive.getState() as unknown as { start: jest.Mock }).start).not.toHaveBeenCalled();
  });
});
