import type { TFunction } from 'i18next';

import type { ToolId } from '@/lib/toolbarSpec';
import type { Clip } from '@/types/project';

import { buildToolRegistry, type ToolRegistryDeps } from './toolRegistry';

/**
 * 🧰 Az eszköz-regiszter regressziós pajzsa (a bontás előtti viselkedés rögzítve):
 * minden eszköz ikonja, címke-kulcsa, panelje / akciója és tutorial-célpontja,
 * valamint a multi-/ripple-függő címkék és ikonok.
 */

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

const ADD = ['addVideo', 'addPip', 'addImage', 'addText', 'addHotspot', 'addAdjust'] as const;
const CLIP = [
  'split', 'duplicate', 'copyClipsAction', 'cutClipsAction', 'pasteClipsAction', 'moveToNextTrack',
  'remove', 'copyStyleAction', 'pasteStyleAction', 'frameCaptureAction', 'toggleMultiSelect', 'toggleRipple',
] as const;

function deps(over: Partial<ToolRegistryDeps> = {}): ToolRegistryDeps {
  return {
    t,
    selected: null,
    multi: false,
    batchCount: 1,
    multiSelectMode: false,
    rippleMode: false,
    add: Object.fromEntries(ADD.map((k) => [k, jest.fn()])) as unknown as ToolRegistryDeps['add'],
    clip: Object.fromEntries(CLIP.map((k) => [k, jest.fn()])) as unknown as ToolRegistryDeps['clip'],
    setShowCamera: jest.fn(),
    setShowSource: jest.fn(),
    setShowHelp: jest.fn(),
    linkSelected: jest.fn(),
    preCompose: jest.fn(),
    unlinkClip: jest.fn(),
    ...over,
  };
}

/** [id, ikon, címke, panel | null, tutorialId | null] — alap állapotban (nincs multi/ripple) */
const TABLE: [ToolId, string, string, string | null, string | null][] = [
  ['addVideo', 'videocam-outline', 'editor.toolbar.video', null, 'toolbar.addVideo'],
  ['addText', 'text-outline', 'editor.toolbar.text', null, 'toolbar.text'],
  ['music', 'musical-notes-outline', 'editor.toolbar.music', 'audio', 'toolbar.music'],
  ['captions', 'chatbox-ellipses-outline', 'editor.toolbar.captions', 'captions', 'toolbar.captions'],
  ['addImage', 'image-outline', 'editor.toolbar.image', null, null],
  ['addPip', 'albums-outline', 'PiP', null, null],
  ['record', 'radio-button-on-outline', 'editor.toolbar.record', null, null],
  ['source', 'folder-open-outline', 'source.title', null, null],
  ['sticker', 'happy-outline', 'editor.toolbar.sticker', 'sticker', null],
  ['transcript', 'reader-outline', 'editor.toolbar.transcript', 'transcript', null],
  ['addGrade', 'color-filter-outline', 'editor.toolbar.grade', null, 'toolbar.grade'],
  ['imagedoc', 'layers-outline', 'editor.toolbar.layers', 'imagedoc', null],
  ['library', 'server-outline', 'editor.toolbar.library', 'library', null],
  ['multicam', 'videocam-outline', 'editor.toolbar.multicam', 'multicam', 'toolbar.multicam'],
  ['addHotspot', 'scan-outline', 'Hotspot', null, null],
  ['assistant', 'sparkles-outline', 'AI', 'assistant', 'toolbar.ai'],
  ['creatorPreset', 'bookmarks-outline', 'editor.toolbar.creatorPreset', 'creatorPreset', null],
  ['workflow', 'git-branch-outline', 'editor.toolbar.workflow', 'workflow', null],
  ['help', 'help-circle-outline', 'editor.toolbar.help', null, null],
  ['split', 'cut-outline', 'editor.toolbar.split', null, null],
  ['speed', 'speedometer-outline', 'editor.toolbar.speed', 'speed', null],
  ['filter', 'color-filter-outline', 'editor.toolbar.filter', 'filter', null],
  ['transition', 'contrast-outline', 'editor.toolbar.transition', 'transition', null],
  ['pip', 'ellipse-outline', 'editor.toolbar.frame', 'pip', null],
  ['frameCapture', 'camera-outline', 'editor.toolbar.frameCapture', null, null],
  ['text', 'text-outline', 'editor.toolbar.text', 'text', null],
  ['shape', 'shapes-outline', 'editor.toolbar.shape', 'shape', null],
  ['grade', 'color-filter-outline', 'editor.toolbar.grade', 'adjust', null],
  ['mix', 'options-outline', 'editor.toolbar.mix', 'audio', null],
  ['action', 'link-outline', 'editor.toolbar.action', 'hotspot', null],
  ['precision', 'timer-outline', 'editor.toolbar.precision', 'precision', null],
  ['duplicate', 'copy-outline', 'common.duplicate', null, null],
  ['copyClip', 'albums-outline', 'editor.toolbar.copyClip', null, null],
  ['cutClip', 'cut-outline', 'editor.toolbar.cutClip', null, null],
  ['pasteClip', 'clipboard-outline', 'editor.toolbar.pasteClip', null, null],
  ['copyStyle', 'clipboard-outline', 'editor.toolbar.copyStyle', null, null],
  ['pasteStyle', 'color-wand-outline', 'editor.toolbar.pasteStyle', null, null],
  ['moveTrack', 'swap-vertical-outline', 'editor.toolbar.moveTrack', null, null],
  ['multiSelect', 'checkmark-done-outline', 'editor.toolbar.multiSelect', null, null],
  ['ripple', 'git-commit-outline', 'editor.toolbar.ripple', null, null],
  ['link', 'link', 'editor.toolbar.link', null, null],
  ['precompose', 'cube-outline', 'editor.toolbar.precompose', null, null],
  ['unlink', 'unlink', 'editor.toolbar.unlink', null, null],
];

describe('buildToolRegistry — az eszközök regisztere', () => {
  it('pontosan a táblázat eszközei, ebben a sorrendben', () => {
    expect(Object.keys(buildToolRegistry(deps()))).toEqual(TABLE.map((r) => r[0]));
  });

  it.each(TABLE)('%s: ikon, címke, panel, tutorial-célpont', (id, icon, label, panel, tutorialId) => {
    const def = buildToolRegistry(deps())[id];
    expect(def.icon).toBe(icon);
    expect(def.label).toBe(label);
    expect(def.panel ?? null).toBe(panel);
    expect(def.tutorialId ?? null).toBe(tutorialId);
    // panelt vált VAGY akciót futtat — a kettő kizárja egymást
    expect(def.onPress).toEqual(panel ? undefined : expect.any(Function));
  });

  it('az akció-eszközök a megfelelő akciót hívják', () => {
    const d = deps();
    const tools = buildToolRegistry(d);
    const wiring: [ToolId, jest.Mock][] = [
      ['addVideo', d.add.addVideo as jest.Mock],
      ['addText', d.add.addText as jest.Mock],
      ['addImage', d.add.addImage as jest.Mock],
      ['addPip', d.add.addPip as jest.Mock],
      ['addGrade', d.add.addAdjust as jest.Mock],
      ['addHotspot', d.add.addHotspot as jest.Mock],
      ['split', d.clip.split as jest.Mock],
      ['frameCapture', d.clip.frameCaptureAction as jest.Mock],
      ['duplicate', d.clip.duplicate as jest.Mock],
      ['copyClip', d.clip.copyClipsAction as jest.Mock],
      ['cutClip', d.clip.cutClipsAction as jest.Mock],
      ['pasteClip', d.clip.pasteClipsAction as jest.Mock],
      ['copyStyle', d.clip.copyStyleAction as jest.Mock],
      ['pasteStyle', d.clip.pasteStyleAction as jest.Mock],
      ['moveTrack', d.clip.moveToNextTrack as jest.Mock],
      ['multiSelect', d.clip.toggleMultiSelect as jest.Mock],
      ['ripple', d.clip.toggleRipple as jest.Mock],
      ['link', d.linkSelected as jest.Mock],
      ['precompose', d.preCompose as jest.Mock],
    ];
    for (const [id, fn] of wiring) {
      expect(tools[id].onPress).toBe(fn);
    }
  });

  it('a Felvétel / Forrás / Súgó a saját lapját nyitja (true)', () => {
    const d = deps();
    const tools = buildToolRegistry(d);
    tools.record.onPress?.();
    tools.source.onPress?.();
    tools.help.onPress?.();
    expect(d.setShowCamera).toHaveBeenCalledWith(true);
    expect(d.setShowSource).toHaveBeenCalledWith(true);
    expect(d.setShowHelp).toHaveBeenCalledWith(true);
  });

  it('a Leválasztás csak kijelölt klippel hívja az unlinkClip-et, annak azonosítójával', () => {
    const empty = deps();
    buildToolRegistry(empty).unlink.onPress?.();
    expect(empty.unlinkClip).not.toHaveBeenCalled();
    const withSel = deps({ selected: { id: 'c1', kind: 'video' } as Clip });
    buildToolRegistry(withSel).unlink.onPress?.();
    expect(withSel.unlinkClip).toHaveBeenCalledWith('c1');
  });

  it('multi-kijelölésnél a Duplikálás és a Stílus-beillesztés címkéje darabszámos', () => {
    const tools = buildToolRegistry(deps({ multi: true, batchCount: 3 }));
    expect(tools.duplicate.label).toBe('editor.toolbar.duplicateCount:{"count":3}');
    expect(tools.pasteStyle.label).toBe('editor.toolbar.pasteStyleCount:{"count":3}');
  });

  it('a multi-mód kapcsoló ikonja, címkéje és aktív jelzése', () => {
    const off = buildToolRegistry(deps()).multiSelect;
    expect(off.active).toBe(false);
    const on = buildToolRegistry(deps({ multiSelectMode: true, batchCount: 2 })).multiSelect;
    expect(on.icon).toBe('checkmark-done');
    expect(on.label).toBe('editor.toolbar.multiSelectActive:{"count":2}');
    expect(on.active).toBe(true);
  });

  it('a ripple-kapcsoló ikonja és aktív jelzése', () => {
    expect(buildToolRegistry(deps()).ripple.active).toBe(false);
    const on = buildToolRegistry(deps({ rippleMode: true })).ripple;
    expect(on.icon).toBe('git-commit');
    expect(on.label).toBe('editor.toolbar.ripple');
    expect(on.active).toBe(true);
  });

  it('a többi eszköznek nincs aktív jelzése (a panel-állapot dönt)', () => {
    const tools = buildToolRegistry(deps({ multiSelectMode: true, rippleMode: true }));
    const withActive = (Object.keys(tools) as ToolId[]).filter((id) => tools[id].active !== undefined);
    expect(withActive).toEqual(['multiSelect', 'ripple']);
  });
});
