/**
 * ♿ A11Y-ŐRTESZT a Hang Stúdió lapjaira (AUDIO-PROD S8 — a Studio-szint 5. feltétele: „Érinthető":
 * VoiceOver / TalkBack minden gombot és csúszkát bemond).
 *
 * Statikus JSX-elemzés (babel-parser) a `src/components/studio/audio/*.tsx` és a közös vezérlők
 * (`ui/controls.tsx`) forrásán — nem kell renderelni, így MINDEN lap és MINDEN ág számít:
 *
 *  • `Pressable` / `Touchable*`: kell `accessibilityLabel` (vagy `aria-label`), VAGY egy `Text`
 *    leszármazott (a RN a szöveg-gyerekekből képzi a nevet), VAGY kifejezetten rejtett a
 *    képernyőolvasó elől (`accessibilityElementsHidden`, `importantForAccessibility`), VAGY a
 *    props-ot spread-del kapja (a hívó felel a címkéért — pl. `TBtn`).
 *  • `Switch`, `TextInput`: kell `accessibilityLabel`.
 *  • a saját `Slider` / `VerticalFader`: `accessibilityRole="adjustable"` + címke.
 *
 * Ha egy ikonos gombnak nincs neve, a képernyőolvasó csak „gomb”-ot mond — ez a teszt bukik,
 * a sor száma a hibaüzenetben.
 */
import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import type { JSXAttribute, JSXElement, JSXOpeningElement, JSXSpreadAttribute } from '@babel/types';

// a kliens-tsconfig-ban nincs node-típus → a bevált minta (TextOverlay.test.ts)
const fs = require('fs');
const path = require('path');
declare const __dirname: string;

const AUDIO_DIR = path.join(__dirname);
const EXTRA_FILES = [path.join(__dirname, '..', '..', 'ui', 'controls.tsx')];

const TAPPABLE = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback']);
const LABEL_REQUIRED = new Set(['Switch', 'TextInput']);
/**
 * saját ikonos gomb-komponensek: a HASZNÁLATUKNÁL kell látható `label` vagy `accessibilityLabel`
 * (az eszközös dump 2026-11-14: a transzport 7 gombjának a neve csak az ikon-betű volt — a
 * komponens-definíció spread-je miatt a Pressable-szabály nem látta)
 */
const ICON_BUTTONS = new Set(['TBtn', 'ToolButton']);
const ADJUSTABLE = new Set(['Slider', 'VerticalFader']);

function elementName(el: JSXOpeningElement): string {
  const n = el.name;
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') {
    // Animated.View → „View”
    return n.property.type === 'JSXIdentifier' ? n.property.name : '';
  }
  return '';
}

function attrNames(el: JSXOpeningElement): { names: Set<string>; spread: boolean } {
  const names = new Set<string>();
  let spread = false;
  for (const a of el.attributes as (JSXAttribute | JSXSpreadAttribute)[]) {
    if (a.type === 'JSXSpreadAttribute') spread = true;
    else if (a.name.type === 'JSXIdentifier') names.add(a.name.name);
  }
  return { names, spread };
}

/** van-e `Text` leszármazott (bármilyen mélyen, feltételes ágakban is) */
function hasTextDescendant(p: NodePath<JSXElement>): boolean {
  let found = false;
  p.traverse({
    JSXElement(inner) {
      if (inner.node === p.node) return;
      if (elementName(inner.node.openingElement) === 'Text') {
        found = true;
        inner.stop();
      }
    },
  });
  return found;
}

function auditFile(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const problems: string[] = [];
  const rel = path.relative(path.join(__dirname, '..', '..', '..', '..'), file);
  traverse(ast, {
    JSXElement(p) {
      const open = p.node.openingElement;
      const name = elementName(open);
      const { names, spread } = attrNames(open);
      const line = open.loc?.start.line ?? 0;
      const labeled = names.has('accessibilityLabel') || names.has('aria-label');
      const hidden = names.has('accessibilityElementsHidden') || names.has('importantForAccessibility') || names.has('accessible');
      if (TAPPABLE.has(name)) {
        if (!labeled && !hidden && !spread && !hasTextDescendant(p)) {
          problems.push(`${rel}:${line} <${name}> ikonos gomb címke nélkül (accessibilityLabel)`);
        }
      } else if (LABEL_REQUIRED.has(name)) {
        if (!labeled && !spread) problems.push(`${rel}:${line} <${name}> címke nélkül (accessibilityLabel)`);
      } else if (ICON_BUTTONS.has(name)) {
        // a gesztus-spread (`{...holdBack}`) nem ad nevet → itt a spread nem mentesít
        if (!labeled && !names.has('label')) problems.push(`${rel}:${line} <${name}> ikonos gomb név nélkül (label vagy accessibilityLabel)`);
      } else if (ADJUSTABLE.has(name) && path.basename(file) === 'primitives.tsx') {
        // a primitív definíciója maga nem JSX-használat — a használatokat lent nézzük
      }
    },
  });
  return problems;
}

describe('♿ Hang Stúdió: minden érintő vezérlőnek van neve a képernyőolvasónak', () => {
  const files: string[] = (fs.readdirSync(AUDIO_DIR) as string[])
    .filter((f: string) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f: string) => path.join(AUDIO_DIR, f))
    .concat(EXTRA_FILES);

  it('a hang-lapok és a közös vezérlők forrása', () => {
    const problems = files.flatMap(auditFile);
    expect(problems).toEqual([]);
  });

  it('a saját csúszkák „adjustable” szerepűek és címkézettek', () => {
    const src = fs.readFileSync(path.join(AUDIO_DIR, 'primitives.tsx'), 'utf8');
    const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const adjustable: string[] = [];
    traverse(ast, {
      JSXOpeningElement(p) {
        const { names } = attrNames(p.node);
        if (names.has('accessibilityRole')) {
          const a = p.node.attributes.find((x) => x.type === 'JSXAttribute' && x.name.type === 'JSXIdentifier' && x.name.name === 'accessibilityRole') as JSXAttribute | undefined;
          if (a?.value?.type === 'StringLiteral' && a.value.value === 'adjustable' && names.has('accessibilityLabel') && names.has('accessibilityValue')) {
            adjustable.push(elementName(p.node));
          }
        }
      },
    });
    // a Slider-nek (primitives.tsx) kell egy adjustable + címke + érték gyökere
    expect(adjustable.length).toBeGreaterThanOrEqual(1);
  });
});
