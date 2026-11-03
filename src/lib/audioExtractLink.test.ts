/** 🔗 A44: a leválasztott hang a videóklippel együtt mozog (link-csoport), egy undo-lépésben. */
import { detachAudioCommands } from '@/lib/audioExtract';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

const video = { id: 'v1', kind: 'video', uri: 'file:///movie.mp4', start: 2, duration: 5, trimIn: 0, sourceDuration: 5, speed: 1, volume: 1, filterId: 'none' } as VideoClip;
const startOf = (id: string) => useEditorStore.getState().project!.tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.start;

function setup(links?: string[][]) {
  const base = createEmptyProject('link', '9:16');
  const project = { ...base, links, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t)) };
  useEditorStore.getState().loadProject(project, []);
}

describe('detachAudioCommands — link (A44)', () => {
  it('a leválasztott hang és a videó link-csoportba kerül, és együtt mozognak', () => {
    setup();
    const { audioClip, commands } = detachAudioCommands(video, 'Hang', useEditorStore.getState().project!.links);
    useEditorStore.getState().applyBatch(commands, 'user');
    const group = useEditorStore.getState().linkGroupOf('v1');
    expect(group).toEqual(expect.arrayContaining(['v1', audioClip.id]));
    useEditorStore.getState().nudgeClipsBy(group!, 1.5);
    expect(startOf('v1')).toBe(3.5);
    expect(startOf(audioClip.id)).toBe(3.5);
  });

  it('a meglévő link-csoportba olvad, nem írja felül a többit', () => {
    setup([['v1', 'x1'], ['y1', 'y2']]);
    const { audioClip, commands } = detachAudioCommands(video, 'Hang', useEditorStore.getState().project!.links);
    useEditorStore.getState().applyBatch(commands, 'user');
    const links = useEditorStore.getState().project!.links!;
    expect(links).toContainEqual(['y1', 'y2']);
    expect(links.find((g) => g.includes('v1'))).toEqual(expect.arrayContaining(['v1', 'x1', audioClip.id]));
  });

  it('egy visszavonás a leválasztást és a linket is visszaveszi', () => {
    setup();
    const { audioClip, commands } = detachAudioCommands(video, 'Hang', undefined);
    useEditorStore.getState().applyBatch(commands, 'user');
    useEditorStore.getState().undo();
    expect(startOf(audioClip.id)).toBeUndefined();
    expect(useEditorStore.getState().project!.links ?? []).toEqual([]);
  });
});
