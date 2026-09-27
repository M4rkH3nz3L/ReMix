import {
  emptyTokens,
  resolveInstance,
  resolveToken,
  shapesToSvg,
  type Component,
  type DesignTokens,
  type SvgShape,
} from '@/lib/designSystem';

describe('designSystem — tokenek', () => {
  const tokens: DesignTokens = {
    ...emptyTokens(),
    colors: { primary: '#5B8CFF', bg: '#12121a' },
    spacing: { md: 16 },
    typography: { h1: { family: 'Inter', size: 32, weight: 700 } },
  };
  it('resolveToken feloldja a csoport.név hivatkozást', () => {
    expect(resolveToken(tokens, 'colors.primary')).toBe('#5B8CFF');
    expect(resolveToken(tokens, 'spacing.md')).toBe(16);
    expect(resolveToken(tokens, 'typography.h1')).toEqual({ family: 'Inter', size: 32, weight: 700 });
  });
  it('ismeretlen hivatkozás → undefined', () => {
    expect(resolveToken(tokens, 'colors.nope')).toBeUndefined();
    expect(resolveToken(tokens, 'nope.x')).toBeUndefined();
  });
});

describe('designSystem — komponens instancia', () => {
  const button: Component = {
    id: 'btn',
    name: 'Button',
    props: [
      { name: 'label', default: 'OK' },
      { name: 'size', default: 'md' },
      { name: 'disabled', default: false },
    ],
    variants: [{ id: 'primary', name: 'Primary', props: { size: 'lg' } }],
  };

  it('defaults ← variáns ← overrides sorrend', () => {
    const inst = resolveInstance(button, 'primary', { label: 'Mentés' });
    expect(inst).toEqual({ label: 'Mentés', size: 'lg', disabled: false });
  });
  it('variáns nélkül csak defaults + overrides', () => {
    expect(resolveInstance(button, undefined, { disabled: true })).toEqual({ label: 'OK', size: 'md', disabled: true });
  });
  it('ismeretlen variáns → defaults', () => {
    expect(resolveInstance(button, 'nope')).toEqual({ label: 'OK', size: 'md', disabled: false });
  });
});

describe('designSystem — SVG export', () => {
  const shapes: SvgShape[] = [
    { kind: 'rect', x: 0, y: 0, width: 100, height: 50, fill: '#5B8CFF', rx: 8 },
    { kind: 'text', x: 10, y: 30, text: 'Hello & <world>', fill: '#fff', fontSize: 16 },
    { kind: 'ellipse', cx: 50, cy: 50, rx: 20, ry: 10 },
    { kind: 'path', d: 'M0 0 L10 10', stroke: '#000', strokeWidth: 2 },
  ];
  it('érvényes SVG-fejléc + viewBox + háttér', () => {
    const svg = shapesToSvg(shapes, { width: 200, height: 100, background: '#000' });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">');
    expect(svg).toContain('<rect x="0" y="0" width="200" height="100" fill="#000" />'); // háttér
    expect(svg).toContain('<rect x="0" y="0" width="100" height="50" rx="8" fill="#5B8CFF" />');
  });
  it('a szöveget escape-eli', () => {
    const svg = shapesToSvg(shapes, { width: 200, height: 100 });
    expect(svg).toContain('Hello &amp; &lt;world&gt;');
  });
  it('path + ellipse renderel', () => {
    const svg = shapesToSvg(shapes, { width: 200, height: 100 });
    expect(svg).toContain('<ellipse cx="50" cy="50" rx="20" ry="10"');
    expect(svg).toContain('<path d="M0 0 L10 10" fill="none" stroke="#000" stroke-width="2" />');
  });
});
