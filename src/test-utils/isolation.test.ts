/* eslint-disable @typescript-eslint/no-require-imports -- Node fs/path a forrásfa bejárásához */
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * 🧱 A `src/test-utils/` csak tesztekből importálható: ha éles kód hivatkozna rá, a fixture-ök
 * (és a `expect`-et hívó segédek) bekerülnének az app-bundle-be. Ez az őr minden nem-teszt
 * forrásfájlt átnéz a `src/` alatt.
 */

const SRC = path.join(process.cwd(), 'src');
const TEST_FILE = /\.test\.tsx?$/;
const SOURCE_FILE = /\.(ts|tsx|js|jsx)$/;
// import … from '…test-utils…' · import '…test-utils…' · require('…test-utils…') · import('…test-utils…') · jest.mock('…test-utils…')
const TEST_UTILS_REF = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*|mock\s*\(\s*)['"][^'"]*test-utils[^'"]*['"]/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

describe('test-utils: csak tesztkódból importálható', () => {
  const testUtilsDir = path.join(SRC, 'test-utils') + path.sep;
  const files: string[] = walk(SRC, []);

  it('a bejárás tényleg látja az éles forrásfájlokat (az őr nem üres halmazon fut)', () => {
    const prod = files.filter((f) => !TEST_FILE.test(f) && !f.startsWith(testUtilsDir));
    expect(prod.length).toBeGreaterThan(100);
    expect(prod.some((f) => f.endsWith(path.join('lib', 'commandBus', 'applyCommand.ts')))).toBe(true);
  });

  it('egyetlen nem-teszt forrásfájl sem hivatkozik a test-utils-ra', () => {
    const offenders = files
      .filter((f) => !TEST_FILE.test(f) && !f.startsWith(testUtilsDir))
      .filter((f) => TEST_UTILS_REF.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });

  it('a mintafelismerés elkapja az import / require / dinamikus import alakokat', () => {
    expect(TEST_UTILS_REF.test("import { track } from '@/test-utils/projectFixtures';")).toBe(true);
    expect(TEST_UTILS_REF.test("const f = require('../test-utils/projectFixtures');")).toBe(true);
    expect(TEST_UTILS_REF.test("await import('@/test-utils/projectFixtures')")).toBe(true);
    expect(TEST_UTILS_REF.test("import '@/test-utils/projectFixtures';")).toBe(true);
    expect(TEST_UTILS_REF.test("const label = 'test-utils nélkül';")).toBe(false);
  });
});
