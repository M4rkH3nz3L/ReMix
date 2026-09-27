import {
  AGENT_PIPELINE,
  ROLE_AGENTS,
  advanceAgentStage,
  agentById,
  agentProgress,
  currentStage,
  isAgentComplete,
  startAgentRun,
} from '@/lib/agents';
import {
  ALL_MARKET_KINDS,
  marketItemMeta,
  marketKindsByCategory,
  newMarketKinds,
} from '@/lib/marketplace';

const T0 = '2026-01-01T00:00:00.000Z';
const mkIder = () => {
  let n = 0;
  return () => `a${++n}`;
};

describe('agents — katalógus + pipeline', () => {
  it('8 szerep-agent', () => {
    expect(ROLE_AGENTS.map((a) => a.id)).toEqual([
      'video-editor', 'art-director', 'music-producer', 'photo-editor', 'writing', 'podcast-producer', 'coding', 'social-media',
    ]);
    expect(agentById('coding')?.role).toBe('developer');
  });

  it('a közös pipeline READ→…→VERIFY', () => {
    expect(AGENT_PIPELINE).toEqual(['read', 'understand', 'plan', 'propose', 'approve', 'execute', 'verify']);
  });

  it('startAgentRun: read aktív, többi pending', () => {
    const run = startAgentRun('video-editor', mkIder(), T0);
    expect(currentStage(run)).toBe('read');
    expect(run.stages.filter((s) => s.status === 'pending')).toHaveLength(6);
  });

  it('advanceAgentStage végigviszi a fázisokat', () => {
    let run = startAgentRun('coding', mkIder(), T0);
    for (let i = 0; i < AGENT_PIPELINE.length; i++) {
      run = advanceAgentStage(run, T0);
    }
    expect(isAgentComplete(run)).toBe(true);
    expect(agentProgress(run)).toBe(1);
    expect(advanceAgentStage(run, T0)).toBe(run); // nincs több → no-op
  });

  it('agentProgress félúton', () => {
    let run = startAgentRun('writing', mkIder(), T0);
    run = advanceAgentStage(run, T0); // read done
    run = advanceAgentStage(run, T0); // understand done
    expect(agentProgress(run)).toBeCloseTo(2 / 7, 2);
  });
});

describe('marketplace — item-kind katalógus (E-Market 2.0)', () => {
  it('a legacy + az új eladható típusok', () => {
    expect(ALL_MARKET_KINDS).toContain('template'); // legacy
    expect(ALL_MARKET_KINDS).toContain('ai-agent'); // új
    expect(marketItemMeta('template').legacy).toBe(true);
    expect(marketItemMeta('workflow').legacy).toBe(false);
  });

  it('newMarketKinds csak az E-Market 2.0 bővítést adja', () => {
    const nk = newMarketKinds();
    expect(nk).toContain('sample-pack');
    expect(nk).toContain('ai-persona');
    expect(nk).not.toContain('template');
  });

  it('kategória szerinti szűrés', () => {
    expect(marketKindsByCategory('ai')).toEqual(expect.arrayContaining(['ai-agent', 'ai-persona']));
    expect(marketKindsByCategory('audio')).toEqual(expect.arrayContaining(['music', 'sample-pack', 'midi', 'instrument']));
  });
});
