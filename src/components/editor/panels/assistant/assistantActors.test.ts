import ts from 'typescript';

/* eslint-disable @typescript-eslint/no-require-imports -- a kliens-tsconfig-ban nincs Node-típus: a Node-beépített modulok require-rel töltődnek */
const fs = require('fs');
const path = require('path');

declare const __dirname: string;

/**
 * 🧾 Őrteszt: az AI-asszisztens MINDEN projekt-írása a command buson megy, és az
 * actor a bontás előttivel azonos — ezen múlik az undo/redo és az eseménynapló
 * („AI csinálta" vs. „user csinálta"). Forrásszintű rögzítés: hívási hely →
 * parancs-típus + actor (`-` = nincs actor-argumentum, a store alapértéke).
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
      out.push(`${n.expression.name.text}:${type}:${actor ? actor.getText(sf).replace(/'/g, '') : '-'}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('AI-asszisztens — command bus actorok', () => {
  it('vágó-eszközök: minden terv EGY dispatch, actor = ai', () => {
    expect(busCalls('useCutTools.tsx')).toEqual([
      'dispatch:REPLACE_TRACKS:ai',
      'dispatch:REPLACE_TRACK_CLIPS:ai',
      'dispatch:REPLACE_TRACK_CLIPS:ai',
      'dispatch:REPLACE_TRACK_CLIPS:ai',
      'dispatch:REPLACE_TRACK_CLIPS:ai',
      'dispatch:REPLACE_TRACK_CLIPS:ai',
    ]);
  });

  it('auto edit: a változat videó + felirat dispatch-e, actor = ai', () => {
    expect(busCalls('useAutoEdit.tsx')).toEqual(['dispatch:REPLACE_TRACK_CLIPS:ai', 'dispatch:ADD_CLIPS:ai']);
  });

  it('reframe: actor = ai; a közösségi preset SET_ASPECT-je actor nélkül (store-alapérték)', () => {
    expect(busCalls('useReframeTools.tsx')).toEqual(['dispatch:REPLACE_TRACK_CLIPS:ai', 'dispatch:SET_ASPECT:-']);
  });

  it('AI-válasz: a preview-visszaállítás RESTORE_SNAPSHOT-ja actor = user; az alkalmazás és a before/after preview EGY applyBatch-köteg, actor = ai', () => {
    expect(busCalls('useAiReply.tsx')).toEqual([
      'dispatch:RESTORE_SNAPSHOT:user',
      'applyBatch:commands:ai',
      'applyBatch:commands:ai',
    ]);
  });

  it('a megjelenítő szekciók és a gyökér nem írnak a projektbe', () => {
    for (const file of [
      'AutoEditSection.tsx',
      'CommandBarSection.tsx',
      'CutToolsSection.tsx',
      'InstructionSection.tsx',
      'SocialPresetsSection.tsx',
      'SuggestionSection.tsx',
      'useWorkerDiag.tsx',
      'useFootageInsights.tsx',
      '../AssistantPanel.tsx',
    ]) {
      expect(busCalls(file)).toEqual([]);
    }
  });
});
