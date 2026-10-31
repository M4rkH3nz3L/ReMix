/**
 * 🌐 A Kép Stúdió minden felirata létezzen mindhárom nyelven. A forrásból gyűjti ki a
 * kulcsokat, így egy új `t()` hívás fordítás nélkül piros lesz (a `defaultValue` eddig
 * elrejtette: az EN/DE userek magyar szöveget láttak).
 */
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import hu from '@/i18n/locales/hu.json';

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.resolve('src/components/studio/image');
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory: () => boolean }) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : e.name.endsWith('.tsx') ? [p] : [];
  });
}
const code = sources(root).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const keys = [...new Set([...code.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)].map((m) => m[1]))];

/** a sablon-kulcsok (`...${x}`) lehetséges értékei */
const dynamic: Record<string, string[]> = {
  'studio.image.blend': ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'softlight', 'hardlight', 'difference', 'exclusion', 'colordodge', 'colorburn'],
  'studio.image.maskDir': ['none', 'left', 'right', 'up', 'down'],
  'studio.image.textPathShape': ['none', 'arc', 'valley', 'wave', 'circle'],
  'studio.image.filterType': ['blur', 'sharpen', 'noise', 'grayscale', 'sepia', 'clarity', 'dehaze', 'pixelate', 'posterize', 'duotone'],
  'studio.image.pattern.kind': ['dots', 'grid', 'stripes', 'checker'],
};
const all = [...keys, ...Object.entries(dynamic).flatMap(([p, vals]) => vals.map((v) => `${p}.${v}`))];

function has(dict: unknown, key: string): boolean {
  const leaf = key.split('.').reduce<unknown>((c, part) => (c as Record<string, unknown> | undefined)?.[part], dict);
  if (typeof leaf === 'string') {
    return true;
  }
  // többes szám: a kulcsnak `_one`/`_other` alakja van
  const parent = key.split('.').slice(0, -1).reduce<unknown>((c, part) => (c as Record<string, unknown> | undefined)?.[part], dict) as Record<string, unknown> | undefined;
  return typeof parent?.[`${key.split('.').pop()}_other`] === 'string';
}

describe('Kép Stúdió fordítások', () => {
  it('a gyűjtő tényleg talál kulcsokat', () => {
    expect(keys.length).toBeGreaterThan(200);
  });
  it.each([['hu', hu], ['en', en], ['de', de]] as const)('%s: egy kulcs sem hiányzik', (_n, dict) => {
    expect(all.filter((k) => !has(dict, k))).toEqual([]);
  });
  it('nincs kód-beli magyar alapszöveg a fordítás helyett a lap-műveleteknél', () => {
    expect(code).not.toMatch(/`Lap \$\{|lap törlése\?`|Lap duplikálva/);
  });
});
