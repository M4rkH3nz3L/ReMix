/**
 * 📋 Őrteszt: az appban és a workerben nincs néma hibakezelés. Minden `catch` és `.catch()` vagy
 * naplóz, vagy továbbdob. Ha ez a teszt bukik, a jelzett helyre `logCaught('hely', e)` kell.
 */
import ts from 'typescript';

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

declare const __dirname: string;

const ROOT: string = path.join(__dirname, '..', '..');
const EXEMPT = [
  /\.test\.(tsx?|js)$/,
  /node_modules/,
  /src\/lib\/logCaught\.ts$/,
  /src\/lib\/bugReporter\.ts$/,
  /src\/lib\/bugReport\.ts$/,
  /src\/lib\/workerAuth\.ts$/,
  /src\/lib\/imageSmoke\.tsx$/,
  /src\/app\/dev-/,
  /Smoke/,
  /server\/scripts\//,
  /server\/bugs\//,
  /server\/media\//,
  /server\/assets\//,
  /server\/lib\/(caught|bugStore|bugReport|log)\.js$/,
  /server\/routes\/bugs\.js$/,
];
const LOGGED = /\b(logCaught|reportBug)\s*\(|\blog\.(warn|error)\s*\(/;

function walk(dir: string, re: RegExp, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory: () => boolean }[]) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|^\.git$/.test(e.name)) walk(p, re, out);
    } else if (re.test(e.name) && !e.name.endsWith('.d.ts') && !EXEMPT.some((r) => r.test(p))) {
      out.push(p);
    }
  }
  return out;
}

function rethrows(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (ts.isThrowStatement(n)) found = true;
    else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function silentSites(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const flag = (n: ts.Node) => out.push(`${path.relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
  const visit = (n: ts.Node) => {
    if (ts.isCatchClause(n) && !LOGGED.test(n.block.getText()) && !rethrows(n.block)) flag(n);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'catch') {
      const a = n.arguments[0];
      if (a && (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && !LOGGED.test(a.body.getText()) && !rethrows(a.body)) flag(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('nincs néma hibakezelés', () => {
  it('az appban minden hiba nyomot hagy', () => {
    expect(walk(path.join(ROOT, 'src'), /\.tsx?$/).flatMap(silentSites)).toEqual([]);
  });
  it('a workerben minden hiba nyomot hagy', () => {
    expect(walk(path.join(ROOT, 'server'), /\.js$/).flatMap(silentSites)).toEqual([]);
  });
});
