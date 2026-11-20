#!/usr/bin/env node
/**
 * 🔁 Körfüggőség-kapu (REFACTOR 0. fázis): a `src/` és a `server/` FUTÁSIDEJŰ import-gráfjában
 * keres köröket (Tarjan-SCC). A `import type` / `export type` és a dinamikus `import()` nem számít
 * (nem hoz létre betöltési kört). A ma meglévő körök a `cycles-baseline.json`-ban vannak — ezek nem
 * nőhetnek, új kör nem keletkezhet. Exit 1, ha sérül a szabály.
 *
 *   node scripts/quality/cycles.js            # ellenőrzés
 *   node scripts/quality/cycles.js --update   # a baseline igazítása (csak megszűnt/zsugorodott körre)
 *   node scripts/quality/cycles.js --list     # minden kör kiírása
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINE = path.join(__dirname, 'cycles-baseline.json');
const SOURCE = /^(src|server)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/;
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
// a platform-változatokat (Metro) is ugyanannak a modulnak vesszük
const PLATFORM = ['', '.native', '.ios', '.android', '.web'];

function trackedSources(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => SOURCE.test(f) && !f.includes('node_modules/') && fs.existsSync(path.join(root, f)));
}

/** A kommentek kivágása, hogy a kikommentelt import ne számítson. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** A futásidejű import-specifikátorok (típus-importok és dinamikus import nélkül). */
function runtimeSpecifiers(src) {
  const code = stripComments(src);
  const out = [];
  const reFrom = /(^|[\s;}])(import|export)\s+(type\s+)?([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = reFrom.exec(code))) {
    if (m[3]) continue; // import type / export type
    const clause = m[4].trim();
    // `import { type A, type B } from` — ha minden név típus, nincs futásidejű kötés
    const braces = clause.match(/^\{([\s\S]*)\}$/);
    if (braces) {
      const names = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith('type '))) continue;
    }
    out.push(m[5]);
  }
  const reSide = /(^|[\s;}])import\s*['"]([^'"]+)['"]/g;
  while ((m = reSide.exec(code))) out.push(m[2]);
  const reReq = /(^|[^.\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reReq.exec(code))) out.push(m[2]);
  return out;
}

function resolveSpecifier(fromFile, spec, root, files) {
  let base;
  if (spec.startsWith('@/')) base = path.join('src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.join(path.dirname(fromFile), spec);
  else return null;
  base = path.normalize(base);
  const candidates = [];
  if (files.has(base)) candidates.push(base);
  for (const p of PLATFORM) for (const e of EXTS) candidates.push(base + p + e);
  for (const p of PLATFORM) for (const e of EXTS) candidates.push(path.join(base, 'index' + p + e));
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

function buildGraph(root = process.cwd()) {
  const list = trackedSources(root).filter((f) => !/\.test\.|__tests__|__mocks__/.test(f));
  const files = new Set(list);
  const graph = new Map();
  for (const f of list) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const deps = new Set();
    for (const s of runtimeSpecifiers(src)) {
      const r = resolveSpecifier(f, s, root, files);
      if (r && r !== f) deps.add(r);
    }
    graph.set(f, [...deps]);
  }
  return graph;
}

/** Tarjan-SCC; csak a ≥2 tagú (vagy önhivatkozó) komponenseket adja vissza, rendezve. */
function findCycles(graph) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  const strong = (v) => {
    // iteratív, hogy a mély gráf ne fusson stack-túlcsordulásba
    const work = [[v, 0]];
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, i] = frame;
      const deps = graph.get(node) || [];
      if (i < deps.length) {
        frame[1]++;
        const w = deps[i];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(node, Math.min(low.get(node), idx.get(w)));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
        if (low.get(node) === idx.get(node)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            comp.push(w);
          } while (w !== node);
          if (comp.length > 1) sccs.push(comp.sort());
        }
      }
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  return sccs.sort((a, b) => a[0].localeCompare(b[0]));
}

function main(argv, root = process.cwd()) {
  const cycles = findCycles(buildGraph(root));
  if (argv.includes('--list')) for (const c of cycles) console.log(`• ${c.join('\n  ')}`);
  if (!fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(cycles, null, 2)}\n`);
    console.log(`✅ körfüggőség-baseline írva: ${cycles.length} kör`);
    return 0;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const problems = [];
  for (const c of cycles) {
    // egy kör akkor „ismert”, ha minden tagja ugyanabban a baseline-körben szerepel
    const known = baseline.find((b) => c.every((f) => b.includes(f)));
    if (!known) problems.push(`új körfüggőség (${c.length} fájl):\n    ${c.join('\n    ')}`);
  }
  for (const p of problems) console.error(`❌ ${p}`);
  if (problems.length) return 1;
  if (argv.includes('--update')) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(cycles, null, 2)}\n`);
  }
  const files = cycles.reduce((n, c) => n + c.length, 0);
  console.log(`✅ körfüggőség: ${cycles.length} ismert kör (${files} fájl), új nincs`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { main, buildGraph, findCycles, runtimeSpecifiers, stripComments };
