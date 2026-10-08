import { resolveShortcut, SHORTCUT_HINTS, type KeyEventLike } from '@/lib/editorKeymap';

const ev = (over: Partial<KeyEventLike> & { key: string }): KeyEventLike => over;

describe('resolveShortcut — egységes billentyű-parancskészlet (EDITOR-UX §2.7)', () => {
  it('space → lejátszás/szünet', () => {
    expect(resolveShortcut(ev({ key: ' ' }))).toBe('playPause');
    expect(resolveShortcut(ev({ key: 'Spacebar' }))).toBe('playPause');
  });

  it('J-K-L → jog vissza / stop / jog előre', () => {
    expect(resolveShortcut(ev({ key: 'j' }))).toBe('jogBack');
    expect(resolveShortcut(ev({ key: 'k' }))).toBe('stop');
    expect(resolveShortcut(ev({ key: 'l' }))).toBe('jogForward');
  });

  it('nagybetű is ugyanaz (Shift-lel írt betű)', () => {
    expect(resolveShortcut(ev({ key: 'J', shiftKey: true }))).toBe('jogBack');
    expect(resolveShortcut(ev({ key: 'S', shiftKey: true }))).toBe('split');
  });

  it('←/→ → frame-léptetés', () => {
    expect(resolveShortcut(ev({ key: 'ArrowLeft' }))).toBe('frameBack');
    expect(resolveShortcut(ev({ key: 'ArrowRight' }))).toBe('frameForward');
  });

  it('I/O → be/ki-pont, S → vágás', () => {
    expect(resolveShortcut(ev({ key: 'i' }))).toBe('setIn');
    expect(resolveShortcut(ev({ key: 'o' }))).toBe('setOut');
    expect(resolveShortcut(ev({ key: 's' }))).toBe('split');
  });

  it('⌫ és Delete → törlés', () => {
    expect(resolveShortcut(ev({ key: 'Backspace' }))).toBe('delete');
    expect(resolveShortcut(ev({ key: 'Delete' }))).toBe('delete');
  });

  it('⌘Z / Ctrl+Z → undo, ⇧-vel redo', () => {
    expect(resolveShortcut(ev({ key: 'z', metaKey: true }))).toBe('undo');
    expect(resolveShortcut(ev({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(resolveShortcut(ev({ key: 'z', metaKey: true, shiftKey: true }))).toBe('redo');
    expect(resolveShortcut(ev({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  it('Ctrl+Y → redo (Windows-konvenció)', () => {
    expect(resolveShortcut(ev({ key: 'y', ctrlKey: true }))).toBe('redo');
  });

  it('⌘/Ctrl + C/X/V → klip-vágólap', () => {
    expect(resolveShortcut(ev({ key: 'c', metaKey: true }))).toBe('copy');
    expect(resolveShortcut(ev({ key: 'x', metaKey: true }))).toBe('cut');
    expect(resolveShortcut(ev({ key: 'v', ctrlKey: true }))).toBe('paste');
  });

  it('⌘ NÉLKÜL a C/X/V nem vágólap (sima betű) — null', () => {
    expect(resolveShortcut(ev({ key: 'c' }))).toBeNull();
    expect(resolveShortcut(ev({ key: 'v' }))).toBeNull();
  });

  it('szövegmezőben SEMMI nem sül el (a gépelést nem raboljuk el)', () => {
    expect(resolveShortcut(ev({ key: ' ', inTextInput: true }))).toBeNull();
    expect(resolveShortcut(ev({ key: 'z', metaKey: true, inTextInput: true }))).toBeNull();
    expect(resolveShortcut(ev({ key: 's', inTextInput: true }))).toBeNull();
  });

  it('Alt-kombókat nem foglalunk le', () => {
    expect(resolveShortcut(ev({ key: 's', altKey: true }))).toBeNull();
    expect(resolveShortcut(ev({ key: 'i', altKey: true }))).toBeNull();
  });

  it('ismeretlen billentyű → null (a hívó ne preventDefault-oljon)', () => {
    expect(resolveShortcut(ev({ key: 'q' }))).toBeNull();
    expect(resolveShortcut(ev({ key: 'Tab' }))).toBeNull();
    expect(resolveShortcut(ev({ key: 'F5' }))).toBeNull();
  });
});

describe('SHORTCUT_HINTS — help-overlay forrás', () => {
  it('minden akcióhoz van címke, és minden kulcs egyedi akció', () => {
    const actions = SHORTCUT_HINTS.map((h) => h.action);
    expect(new Set(actions).size).toBe(actions.length);
    for (const h of SHORTCUT_HINTS) {
      expect(h.keys.length).toBeGreaterThan(0);
    }
  });
});
