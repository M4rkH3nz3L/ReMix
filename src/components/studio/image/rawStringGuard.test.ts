/**
 * 🌐 NYERS-STRING ŐRTESZT a Kép Stúdióra (IMAGE-PROD S3). Az `imageLocaleParity` csak a `t()`
 * hívásokat látja; ez a teszt a látható, NEM fordított szöveget keresi a `studio/image` (és a `body/`)
 * komponenseiben, statikus JSX-elemzéssel (babel-parser):
 *
 *  • JSX-szöveg betűvel (`<Text>Mentés</Text>`) — kivéve a tiszta jelet/számot/emojit;
 *  • szöveges literál a látható / felolvasott propokban (`label`, `title`, `placeholder`,
 *    `accessibilityLabel`, `accessibilityHint`, `hint`, `message`).
 *
 * A `t('…', { defaultValue: '…' })` alapértéke nem számít (az a fordítás tartaléka). Ha valami
 * szándékosan nem fordítandó (márkanév), az `ALLOW` listába kerül, indoklással.
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

// a kliens-tsconfig-ban nincs node-típus → a bevált minta (TextOverlay.test.ts)
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
declare const __dirname: string;

const DIRS = [path.join(__dirname), path.join(__dirname, 'body')];
const VISIBLE_PROPS = new Set(['label', 'title', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'hint', 'message']);
/** szándékosan nem fordított, látható szövegek (márka / mértékegység / formátum-név) */
// a „ffffff” a hex színmező helyőrzője, a „PRO” jelvény és a „HSL” rövidítés minden nyelven ugyanaz
const ALLOW = new Set(['ReMix', 'PNG', 'JPG', 'WebP', 'PDF', 'PSD', 'SVG', 'GIF', 'px', 'Pro', 'PRO', 'HSL', 'ffffff']);
const LETTER = /\p{L}{2,}/u;

function findings(file: string): string[] {
  const src: string = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const out: string[] = [];
  const bad = (text: string) => {
    const s = text.replace(/\s+/g, ' ').trim();
    return s.length > 0 && LETTER.test(s) && !ALLOW.has(s);
  };
  traverse(ast, {
    JSXText(p) {
      if (bad(p.node.value)) out.push(`${path.basename(file)}:${p.node.loc?.start.line} „${p.node.value.trim()}”`);
    },
    JSXAttribute(p) {
      const n = p.node.name.type === 'JSXIdentifier' ? p.node.name.name : '';
      if (!VISIBLE_PROPS.has(n)) return;
      const v = p.node.value;
      const lit = v?.type === 'StringLiteral' ? v.value : v?.type === 'JSXExpressionContainer' && v.expression.type === 'StringLiteral' ? v.expression.value : null;
      if (lit != null && bad(lit)) out.push(`${path.basename(file)}:${p.node.loc?.start.line} ${n}=„${lit}”`);
    },
  });
  return out;
}

describe('🌐 Kép Stúdió: nincs nyers (fordítatlan) UI-szöveg', () => {
  const files: string[] = DIRS.flatMap((d: string) =>
    fs.readdirSync(d).filter((f: string) => f.endsWith('.tsx') && !f.includes('.test.')).map((f: string) => path.join(d, f))
  );
  it('a fájlok megvannak (a teszt nem üres)', () => {
    expect(files.length).toBeGreaterThan(40);
  });
  it('ellenpróba: a nyers szöveget és a nyers címkét megtalálja, a t()-t és a jelet nem', () => {
    const os = require('os');
    const tmp = path.join(os.tmpdir(), `rawguard_${Date.now()}.tsx`);
    fs.writeFileSync(tmp, "const A = () => <View><Text>Mentés</Text><Text>{t('a.b')}</Text><Text>×</Text><Chip label=\"Kész\" /><Chip label={t('x')} /></View>;");
    const f = findings(tmp);
    fs.unlinkSync(tmp);
    expect(f).toHaveLength(2);
    expect(f.join(' ')).toContain('Mentés');
    expect(f.join(' ')).toContain('Kész');
  });
  it('minden látható szöveg a t()-n át megy', () => {
    expect(files.flatMap(findings)).toEqual([]);
  });
});
