import ts from 'typescript';

/* eslint-disable @typescript-eslint/no-require-imports -- a kliens-tsconfig-ban nincs Node-típus: a Node-beépített modulok require-rel töltődnek */
const fs = require('fs');
const path = require('path');

declare const __dirname: string;

/**
 * 🧾 Őrteszt: a szerkesztő-képernyő MINDEN projekt-írása a command buson megy, és az
 * actor a bontás előttivel azonos — ezen múlik az undo/redo és az eseménynapló
 * („rendszer" vs. „user"). Forrásszintű rögzítés: hívási hely → parancs-típus + actor
 * (`-` = nincs actor-argumentum, a store alapértéke). Az applyBatch-nél a köteg elemtípusa.
 */

function busCalls(file: string): string[] {
  const src: string = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ['dispatch', 'applyBatch'].includes(n.expression.name.text)
    ) {
      const [cmd, actor] = n.arguments;
      let type = cmd ? cmd.getText(sf) : '?';
      if (cmd && ts.isObjectLiteralExpression(cmd)) {
        const prop = cmd.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'type'
        );
        type = prop ? prop.initializer.getText(sf).replace(/'/g, '') : '?';
      }
      const batchType = /type: '([A-Z_]+)'/.exec(type);
      if (batchType) {
        type = batchType[1];
      }
      out.push(`${n.expression.name.text}:${type}:${actor ? actor.getText(sf).replace(/'/g, '') : '-'}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('szerkesztő-képernyő — command bus actorok', () => {
  it('betöltéskori automatikus média-visszaállítás: EGY RELINK_URI köteg, actor = system', () => {
    expect(busCalls('useProjectLoader.tsx')).toEqual(['applyBatch:RELINK_URI:system']);
  });

  it('kézi helyreállítás: auto-relink = system, kézi választás = user, átviteli tár és .rp köteg = system', () => {
    expect(busCalls('missingMediaActions.ts')).toEqual([
      'dispatch:cmd:system',
      'dispatch:cmd:user',
      'dispatch:cmd:user',
      'applyBatch:RELINK_URI:system',
      'applyBatch:RELINK_URI:system',
    ]);
  });

  it('a képarány-léptetés SET_ASPECT-je actor nélkül (store-alapérték)', () => {
    expect(busCalls('../../../app/editor/[id].tsx')).toEqual(['dispatch:SET_ASPECT:-']);
  });

  it('a megjelenítő részek és a többi hook nem írnak a projektbe', () => {
    for (const file of [
      'EditorBanners.tsx',
      'EditorHeader.tsx',
      'EditorLayoutBody.tsx',
      'MissingProjectView.tsx',
      'ProjectMenuSheet.tsx',
      'useAutosave.tsx',
      'useEditorCollab.tsx',
      'useEditorWarmup.tsx',
      'useForeignSourceToast.tsx',
      'usePanelDeepLink.tsx',
      'useProjectMenu.tsx',
      'useTransferAvailability.tsx',
    ]) {
      expect(busCalls(file)).toEqual([]);
    }
  });
});

describe('szerkesztő-képernyő — a hookok (és így az effektek) sorrendje', () => {
  it('a gyökér a bontás előtti effekt-sorrendben hívja a hookokat (a kilépő takarítás is ebben fut)', () => {
    const file = '../../../app/editor/[id].tsx';
    const src: string = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hooks: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^use[A-Z]/.test(n.expression.text)) {
        hooks.push(n.expression.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(hooks.filter((h) => !['useEditorStore', 'useEntitlement', 'useState'].includes(h))).toEqual([
      'useTranslation',
      'useLocalSearchParams',
      'useProjectMenu',
      'useKeyboardVisible',
      'useLayout',
      'usePlaybackClock',
      'useEditorCollab', // tagság-effekt → useLiveCollab
      'useTransferAvailability',
      'useForeignSourceToast',
      'usePanelDeepLink',
      'useProjectLoader', // betöltés → kilépéskori felhő-mentés
      'useEditorWarmup', // hang-mód → proxy-előmelegítés
      'useAutosave', // autosave → kilépéskori végső mentés + closeProject
    ]);
  });
});
