import {
  isToolAvailable,
  MAX_PRIMARY_TOOLS,
  toolbarFor,
  type ToolClipKind,
  type ToolContext,
  type ToolId,
} from '@/lib/toolbarSpec';

const base: ToolContext = {
  selectionKind: null,
  multi: false,
  onPipTrack: false,
  linked: false,
  hasClipClipboard: false,
  canPasteStyle: false,
  canMoveTrack: false,
};

/**
 * Regresszió-orákulum: a RÉGI (2026-10-26 előtti) Toolbar.tsx JSX-ének gomb-készlete
 * kontextusonként. Az új eszköztár (elsődleges ∪ Több) pontosan ezt kell lefedje —
 * egyetlen funkció se tűnhet el az átrendezéstől.
 */
function legacyTools(ctx: ToolContext): ToolId[] {
  const k = ctx.selectionKind;
  if (k === null) {
    return [
      'workflow', 'assistant', 'creatorPreset', 'record', 'source', 'addVideo', 'addPip',
      'multicam', 'addGrade', 'addImage', 'addText', 'captions', 'transcript', 'sticker',
      'music', 'imagedoc', 'library', 'addHotspot', 'help',
    ];
  }
  const out: ToolId[] = ['multiSelect'];
  if (ctx.multi) out.push('link', 'precompose');
  if (ctx.linked) out.push('unlink');
  if (!ctx.multi) out.push('split');
  out.push('ripple', 'copyStyle');
  if (ctx.canPasteStyle) out.push('pasteStyle');
  out.push('duplicate', 'copyClip', 'cutClip');
  if (ctx.hasClipClipboard) out.push('pasteClip');
  if (ctx.canMoveTrack) out.push('moveTrack');
  out.push('precision');
  if (k === 'text') out.push('text');
  if (k === 'video' || k === 'image') {
    out.push('filter', 'transition');
    if (ctx.onPipTrack) out.push('pip');
  }
  if (k === 'video') out.push('speed', 'frameCapture');
  if (k === 'shape') out.push('shape');
  if (k === 'adjust') out.push('grade');
  if (k === 'audio') out.push('mix');
  if (k === 'interactive') out.push('action');
  return out;
}

const KINDS: (ToolClipKind | null)[] = [null, 'video', 'image', 'audio', 'text', 'shape', 'adjust', 'interactive'];

/** a kontextus-flagek összes kombinációja minden fajtára */
function allContexts(): ToolContext[] {
  const out: ToolContext[] = [];
  for (const selectionKind of KINDS) {
    for (let mask = 0; mask < 64; mask++) {
      const ctx: ToolContext = {
        selectionKind,
        multi: !!(mask & 1),
        onPipTrack: !!(mask & 2),
        linked: !!(mask & 4),
        hasClipClipboard: !!(mask & 8),
        canPasteStyle: !!(mask & 16),
        canMoveTrack: !!(mask & 32),
      };
      // kijelölés nélkül nincs multi/link/pip (a régi UI sem mutatta)
      if (selectionKind === null && mask !== 0 && mask !== 8) continue;
      out.push(ctx);
    }
  }
  return out;
}

describe('toolbarSpec — 4 elsődleges + Több', () => {
  it.each(allContexts().map((c) => [JSON.stringify(c), c] as const))(
    'teljesség + korlát: %s',
    (_, ctx) => {
      const { primary, overflow } = toolbarFor(ctx);
      expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_TOOLS);
      // nincs duplikáció
      const all = [...primary, ...overflow];
      expect(new Set(all).size).toBe(all.length);
      // egy funkció se tűnt el / nem jelent meg olyan, ami ott nem elérhető
      expect([...all].sort()).toEqual([...legacyTools(ctx)].sort());
    }
  );

  it('kijelölés nélkül: Videó · Szöveg · Zene · Felirat elöl', () => {
    expect(toolbarFor(base).primary).toEqual(['addVideo', 'addText', 'music', 'captions']);
  });

  it('videó-klip: Vágás · Sebesség · Szűrő · Átmenet', () => {
    expect(toolbarFor({ ...base, selectionKind: 'video' }).primary).toEqual([
      'split',
      'speed',
      'filter',
      'transition',
    ]);
  });

  it('szöveg-klip: a szerkesztés az első', () => {
    expect(toolbarFor({ ...base, selectionKind: 'text' }).primary[0]).toBe('text');
  });

  it('hang-klip: a keverés elöl', () => {
    expect(toolbarFor({ ...base, selectionKind: 'audio' }).primary).toContain('mix');
  });

  it('multi-kijelölés: Link + Pre-compose elöl, Vágás nincs', () => {
    const { primary, overflow } = toolbarFor({ ...base, selectionKind: 'video', multi: true });
    expect(primary.slice(0, 2)).toEqual(['link', 'precompose']);
    expect([...primary, ...overflow]).not.toContain('split');
  });

  it('nem elérhető eszköz helyére a következő lép', () => {
    const noPaste = toolbarFor({ ...base, selectionKind: 'video', multi: true });
    expect(noPaste.primary).not.toContain('pasteStyle');
    const withPaste = toolbarFor({ ...base, selectionKind: 'video', multi: true, canPasteStyle: true });
    expect(withPaste.primary).toContain('pasteStyle');
  });

  describe('szerkesztési módok (D5)', () => {
    it('a haladó mód = a mód nélküli (teljes) eszköztár', () => {
      for (const ctx of allContexts()) {
        expect(toolbarFor({ ...ctx, mode: 'advanced' })).toEqual(toolbarFor(ctx));
      }
    });

    it('gyors mód: kevesebb eszköz, de a fajta fő műveletei megmaradnak', () => {
      for (const ctx of allContexts()) {
        const quick = toolbarFor({ ...ctx, mode: 'quick' });
        const full = toolbarFor(ctx);
        const q = [...quick.primary, ...quick.overflow];
        const f = [...full.primary, ...full.overflow];
        expect(q.length).toBeLessThanOrEqual(f.length);
        expect(q.every((id) => isToolAvailable(id, ctx))).toBe(true);
        if (ctx.selectionKind !== null && !ctx.multi) {
          expect(quick.primary).toEqual(full.primary);
        }
      }
      expect(toolbarFor({ ...base, mode: 'quick' }).overflow).not.toContain('multicam');
    });

    it('AI mód: az asszisztens az első eszköz', () => {
      expect(toolbarFor({ ...base, mode: 'ai' }).primary[0]).toBe('assistant');
      expect(toolbarFor({ ...base, mode: 'ai' }).primary).toContain('transcript');
    });
  });
});

