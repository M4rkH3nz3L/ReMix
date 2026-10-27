import { isStudioRoute, PUBLIC_WEB_SCREENS } from '@/lib/webSurface';

// a kliens-tsconfig-ban nincs node-típus → require (mint a contract.test.ts-ben)
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, existsSync } = require('fs');
const { join, relative } = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

const APP_DIR: string = join(process.cwd(), 'src', 'app');

/** Az összes route-fájl (a `.web.tsx` csonkok és a `_layout` nélkül). */
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      return routeFiles(full);
    }
    if (!e.name.endsWith('.tsx') || e.name.endsWith('.web.tsx') || e.name.startsWith('_')) {
      return [];
    }
    return [full];
  });
}

/** `src/app/studio/image/[id].tsx` → `/studio/image/[id]`, `index.tsx` → `/`. */
function toPath(file: string): string {
  const rel = relative(APP_DIR, file).replace(/\.tsx$/, '');
  const path = `/${rel}`.replace(/\/index$/, '');
  return path || '/';
}

describe('webSurface', () => {
  it('felismeri a stúdió-útvonalakat', () => {
    expect(isStudioRoute('/studio')).toBe(true);
    expect(isStudioRoute('/studio/image/p1')).toBe(true);
    expect(isStudioRoute('/editor/p1?panel=assistant')).toBe(true);
    expect(isStudioRoute('/collab/p1')).toBe(true);
    expect(isStudioRoute('/live/studio/p1')).toBe(true);
    expect(isStudioRoute('/editor/')).toBe(true);
    expect(isStudioRoute('/storage')).toBe(true);
  });

  it('a publikus/nézegető útvonalak NEM stúdiók', () => {
    expect(isStudioRoute('/')).toBe(false);
    expect(isStudioRoute('/live')).toBe(false);
    expect(isStudioRoute('/live/abc')).toBe(false);
    expect(isStudioRoute('/player/p1')).toBe(false);
    expect(isStudioRoute('/channel/u1')).toBe(false);
    expect(isStudioRoute('/studios')).toBe(false);
  });

  it('MINDEN stúdió-route-nak van webes csonkja (.web.tsx) — új stúdió sem szivárog a webre', () => {
    const studio = routeFiles(APP_DIR).filter((f) => isStudioRoute(toPath(f)));
    expect(studio.length).toBeGreaterThan(0);
    const missing = studio.filter((f) => !existsSync(f.replace(/\.tsx$/, '.web.tsx')));
    expect(missing.map((f) => relative(APP_DIR, f))).toEqual([]);
  });

  it('a publikus képernyők létező, nem-stúdió route-ok', () => {
    for (const screen of PUBLIC_WEB_SCREENS) {
      expect(existsSync(join(APP_DIR, `${screen}.tsx`))).toBe(true);
      expect(isStudioRoute(`/${screen}`.replace(/\/index$/, '/'))).toBe(false);
    }
  });
});
