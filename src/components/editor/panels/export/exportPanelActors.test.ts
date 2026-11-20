import ts from 'typescript';

/* eslint-disable @typescript-eslint/no-require-imports -- a kliens-tsconfig-ban nincs Node-típus: a Node-beépített modulok require-rel töltődnek */
const fs = require('fs');
const path = require('path');

declare const __dirname: string;

/**
 * 🧾 Őrteszt: az export-panel MINDEN projekt-írása a command buson megy, és az
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


function hookCalls(file: string): string[] {
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
  return hooks;
}

describe('export-panel — command bus actorok', () => {
  it('a thumbnail-lap választása EGY köteg (UPSERT_IMAGE_DOC + SET_THUMBNAIL_DOC), actor = user', () => {
    expect(busCalls('thumbActions.ts')).toEqual(['applyBatch:UPSERT_IMAGE_DOC:user']);
  });

  it('a gyökér, a szekciók és a többi művelet nem dispatch-el', () => {
    for (const file of [
      '../ExportPanel.tsx',
      'AdvancedExportControls.tsx',
      'CaptionsSection.tsx',
      'InteractiveSection.tsx',
      'PostSection.tsx',
      'ProStatusBanner.tsx',
      'ProjectFileSection.tsx',
      'ThumbnailStudioSection.tsx',
      'VideoExportSection.tsx',
      'projectFileActions.ts',
      'videoExportActions.ts',
      'useExportSettings.ts',
      'useThumbStudioState.ts',
    ]) {
      expect(busCalls(file)).toEqual([]);
    }
  });
});

describe('export-panel — a hookok (és így az állapot-slotok) sorrendje', () => {
  it('a gyökér a bontás előtti sorrendben hívja a hookokat', () => {
    expect(hookCalls('../ExportPanel.tsx')).toEqual([
      'useTranslation',
      'useEditorStore',
      'useEditorStore',
      'useEntitlement',
      'useEntitlement',
      'usePaywall',
      'useRef',
      'useEffect', // füstteszt: video.exportLocal regisztrálása
      'useState', // renderStatus
      'useState', // collectStatus
      'useState', // cloudStatus
      'useExportSettings',
      'useThumbStudioState',
    ]);
  });

  it('a beállítás-hook 15, a thumbnail-hook 5 állapota az eredeti sorrendben', () => {
    const states = (file: string) =>
      (fs.readFileSync(path.join(__dirname, file), 'utf8') as string)
        .split('\n')
        .map((l) => /const \[(\w+), set\w+\] = useState/.exec(l)?.[1])
        .filter(Boolean);
    expect(states('useExportSettings.ts')).toEqual([
      'resolution',
      'fps',
      'quality',
      'codec',
      'engine',
      'platform',
      'batchSet',
      'advOpen',
      'bitrateMode',
      'bitrateMbps',
      'gop',
      'bitDepth',
      'colorMode',
      'sampleRate',
      'channels',
    ]);
    expect(states('useThumbStudioState.ts')).toEqual([
      'thumbStatus',
      'thumbs',
      'headlines',
      'headlineStatus',
      'selectedHeadline',
    ]);
  });
});
