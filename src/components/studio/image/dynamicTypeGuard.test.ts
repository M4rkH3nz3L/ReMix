/**
 * 🔠 DYNAMIC TYPE-ŐRTESZT a Kép Stúdióra (IMAGE-PROD S2): a lapok, sávok, chipek szövege a rendszer
 * betűméretével nő, de legfeljebb 1,3×-re (különben a sűrű vezérlőkön levágódna) — minden `Text` /
 * `TextInput` kap `maxFontSizeMultiplier`-t. A vászon szövege szándékosan független a rendszer-
 * betűmérettől (`allowFontScaling={false}`, §23.30): az a kész kép része, nem felület.
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
declare const __dirname: string;

const FILES: string[] = [path.join(__dirname), path.join(__dirname, 'body')].flatMap((d: string) =>
  fs.readdirSync(d).filter((f: string) => f.endsWith('.tsx') && !f.includes('.test.')).map((f: string) => path.join(d, f))
);
const SHARED = [path.join(__dirname, '../../ui/controls.tsx'), path.join(__dirname, '../audio/primitives.tsx')];

function uncapped(file: string, only?: Set<number>): string[] {
  const src: string = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const out: string[] = [];
  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node.name;
      const name = n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? n.property.name : '';
      if (name !== 'Text' && name !== 'TextInput') return;
      const line = p.node.loc?.start.line ?? 0;
      if (only && !only.has(line)) return;
      const attrs = p.node.attributes.flatMap((a) => (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' ? [a.name.name] : []));
      if (!attrs.includes('maxFontSizeMultiplier') && !attrs.includes('allowFontScaling')) out.push(`${path.basename(file)}:${line}`);
    },
  });
  return out;
}

describe('🔠 Kép Stúdió: a felület szövege legfeljebb 1,3×-re nő', () => {
  it('minden Text / TextInput korlátozott (vagy a vászon része)', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.flatMap((f) => uncapped(f))).toEqual([]);
  });
  it('a közös Chip és csúszka felirata is', () => {
    const chip = uncapped(SHARED[0]).filter((x) => x.endsWith(':40'));
    expect(chip).toEqual([]);
    const src: string = fs.readFileSync(SHARED[1], 'utf8');
    expect(src).toContain('styles.sliderLabel} maxFontSizeMultiplier={1.3}');
    expect(src).toContain('styles.sliderVal} maxFontSizeMultiplier={1.3}');
  });
});
