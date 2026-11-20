#!/usr/bin/env node
/**
 * 🧾 Publikus API-kapu (REFACTOR 0. fázis): a `src/` és a `server/` minden moduljának export-felülete
 * — név + fajta (érték/típus) + a TypeScript által kiszámolt típus hash-e — az `api-surface.json`
 * pillanatképben. Fájlbontásnál az eredeti modul re-exportál, így a felülete bitre azonos marad.
 * Exit 1, ha egy rögzített export eltűnt vagy megváltozott a típusa (új export / új fájl megengedett).
 *
 *   node scripts/quality/api-surface.js                 # ellenőrzés
 *   node scripts/quality/api-surface.js --update        # a pillanatkép újraírása (jóváhagyott API-változás)
 *   node scripts/quality/api-surface.js --show <fájl>   # egy modul exportjai teljes típussal
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SNAPSHOT = path.join(__dirname, 'api-surface.json');
const SKIP = /(\.test\.|__tests__|__mocks__|node_modules|\.d\.ts$)/;

function program(root, configFile, extraOptions = {}) {
  const cfg = ts.readConfigFile(path.join(root, configFile), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.join(root, path.dirname(configFile)));
  return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, ...extraOptions, noEmit: true } });
}

const FLAGS =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType | ts.TypeFormatFlags.WriteArrayAsGenericType;

/** Egy program `prefix` alatti forrásfájljainak export-felülete: { fájl: { név: 'v:hash' | 't:hash' } }. */
function surfaceOf(prog, root, prefix) {
  const checker = prog.getTypeChecker();
  const out = {};
  for (const sf of prog.getSourceFiles()) {
    const rel = path.relative(root, sf.fileName).split(path.sep).join('/');
    if (!rel.startsWith(prefix) || SKIP.test(rel)) continue;
    const modSym = checker.getSymbolAtLocation(sf);
    if (!modSym) continue;
    const entry = {};
    for (const exp of checker.getExportsOfModule(modSym)) {
      const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      const isValue = (sym.flags & ts.SymbolFlags.Value) !== 0;
      let text;
      if (isValue) {
        text = checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, sf), sf, FLAGS);
      } else {
        text = checker.typeToString(checker.getDeclaredTypeOfSymbol(sym), sf, FLAGS | ts.TypeFormatFlags.InTypeAlias);
      }
      const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
      entry[exp.name] = { kind: isValue ? 'v' : 't', hash, text };
    }
    if (Object.keys(entry).length) out[rel] = entry;
  }
  return out;
}

function collect(root = process.cwd()) {
  const client = surfaceOf(program(root, 'tsconfig.json'), root, 'src/');
  // a worker CommonJS: a TS a `module.exports`-ból is kiszámolja a felületet (checkJs nélkül is)
  const serverFiles = ts.sys
    .readDirectory(path.join(root, 'server'), ['.js'], ['**/node_modules/**'], ['**/*'])
    .filter((f) => !SKIP.test(f));
  const sprog = ts.createProgram({
    rootNames: serverFiles,
    options: { allowJs: true, checkJs: false, noEmit: true, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, target: ts.ScriptTarget.ES2022, resolveJsonModule: true, skipLibCheck: true, types: ['node'], strict: true },
  });
  const server = surfaceOf(sprog, root, 'server/');
  return { ...client, ...server };
}

const compact = (surface) =>
  Object.fromEntries(
    Object.keys(surface)
      .sort()
      .map((f) => [f, Object.fromEntries(Object.keys(surface[f]).sort().map((n) => [n, `${surface[f][n].kind}:${surface[f][n].hash}`]))]),
  );

function main(argv, root = process.cwd()) {
  const surface = collect(root);
  const showAt = argv.indexOf('--show');
  if (showAt >= 0) {
    const f = argv[showAt + 1];
    for (const [n, e] of Object.entries(surface[f] || {})) console.log(`${e.kind} ${n}: ${e.text}`);
    return 0;
  }
  const now = compact(surface);
  if (argv.includes('--update') || !fs.existsSync(SNAPSHOT)) {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 1)}\n`);
    console.log(`✅ API-pillanatkép írva: ${Object.keys(now).length} modul`);
    return 0;
  }
  const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const problems = [];
  for (const [f, names] of Object.entries(before)) {
    for (const [n, sig] of Object.entries(names)) {
      const cur = now[f]?.[n];
      if (!cur) problems.push(`${f}: a(z) \`${n}\` export eltűnt`);
      else if (cur !== sig) problems.push(`${f}: a(z) \`${n}\` export típusa megváltozott (${sig} → ${cur}); részletek: --show ${f}`);
    }
  }
  for (const p of problems) console.error(`❌ ${p}`);
  if (problems.length) return 1;
  const total = Object.values(before).reduce((n, e) => n + Object.keys(e).length, 0);
  console.log(`✅ API-felület: ${total} rögzített export ${Object.keys(before).length} modulban változatlan`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { main, collect, compact };
