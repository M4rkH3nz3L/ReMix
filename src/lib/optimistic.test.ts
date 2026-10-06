import { runOptimistic } from '@/lib/optimistic';

describe('runOptimistic (audit §12.4)', () => {
  it('siker: apply + commit fut, rollback NEM, onSuccess megkapja az eredményt, → true', async () => {
    const calls: string[] = [];
    const ok = await runOptimistic<number>({
      apply: () => calls.push('apply'),
      rollback: () => calls.push('rollback'),
      commit: async () => {
        calls.push('commit');
        return 42;
      },
      onSuccess: (r) => calls.push(`success:${r}`),
    });
    expect(ok).toBe(true);
    expect(calls).toEqual(['apply', 'commit', 'success:42']);
  });

  it('hiba: apply fut, majd rollback + onError(error), → false', async () => {
    const calls: string[] = [];
    const err = new Error('network');
    const ok = await runOptimistic({
      apply: () => calls.push('apply'),
      rollback: () => calls.push('rollback'),
      commit: async () => {
        throw err;
      },
      onError: (e) => calls.push(`error:${(e as Error).message}`),
    });
    expect(ok).toBe(false);
    expect(calls).toEqual(['apply', 'rollback', 'error:network']);
  });

  it('az apply MINDIG a commit ELŐTT fut (azonnali visszajelzés)', async () => {
    const order: string[] = [];
    await runOptimistic({
      apply: () => order.push('apply'),
      rollback: () => {},
      commit: async () => {
        order.push('commit');
      },
    });
    expect(order[0]).toBe('apply');
    expect(order[1]).toBe('commit');
  });

  it('nem dob hibát akkor sem, ha nincs onError (fire-and-forget biztonság)', async () => {
    await expect(
      runOptimistic({
        apply: () => {},
        rollback: () => {},
        commit: async () => {
          throw new Error('boom');
        },
      })
    ).resolves.toBe(false);
  });
});
