'use strict';

const { OrchestrationEngine } = require('../../src/orchestration/engine');

describe('OrchestrationEngine - basic execution', () => {
  it('should run a simple pipeline and return context', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({
      id: 'step1',
      handler: async () => ({ result: 'done' }),
    });

    const output = await engine.run({});
    expect(output.context.result).toBe('done');
    expect(output.metrics.stagesCompleted).toBe(1);
    expect(output.metrics.successRate).toBe(1);
  });

  it('should pass context between stages', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({
      id: 'step1',
      handler: async () => ({ value: 42 }),
    });

    engine.addStage({
      id: 'step2',
      deps: ['step1'],
      handler: async (ctx) => ({ doubled: ctx.value * 2 }),
    });

    const output = await engine.run({});
    expect(output.context.doubled).toBe(84);
  });

  it('should produce an audit log', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({
      id: 'step1',
      handler: async () => ({ done: true }),
    });

    const output = await engine.run({});
    expect(output.auditLog.length).toBeGreaterThan(0);

    const events = output.auditLog.map(e => e.event);
    expect(events).toContain('pipeline_started');
    expect(events).toContain('stage_completed');
    expect(events).toContain('pipeline_completed');
  });

  it('should track metrics correctly', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({
      id: 'step1',
      handler: async () => ({ done: true }),
    });

    const output = await engine.run({});
    expect(output.metrics.stagesCompleted).toBe(1);
    expect(output.metrics.stagesFailed).toBe(0);
    expect(output.metrics.e2eLatencyMs).toBeGreaterThanOrEqual(0);
    expect(output.metrics.successRate).toBe(1);
  });
});

describe('OrchestrationEngine - retry logic', () => {
  it('should retry a failing stage and succeed', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });
    let attempts = 0;

    engine.addStage({
      id: 'flaky',
      policy: { maxRetries: 2, retryDelayMs: 10, timeoutMs: 5000 },
      handler: async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return { recovered: true };
      },
    });

    const output = await engine.run({});
    expect(output.context.recovered).toBe(true);
    expect(output.metrics.retryCount).toBe(2);
  });

  it('should fail after exhausting retries', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({
      id: 'always-fails',
      policy: { maxRetries: 1, retryDelayMs: 10, timeoutMs: 5000 },
      handler: async () => {
        throw new Error('Always fails');
      },
    });

    await expect(engine.run({})).rejects.toThrow('Always fails');
    expect(engine.getMetrics().retryCount).toBe(1);
  });
});

describe('OrchestrationEngine - safe stop', () => {
  it('should stop pipeline when safeStop is called', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });
    const executed = [];

    engine.addStage({
      id: 'step1',
      handler: async () => {
        executed.push('step1');
        engine.safeStop('test stop');
      },
    });

    engine.addStage({
      id: 'step2',
      deps: ['step1'],
      handler: async () => {
        executed.push('step2');
      },
    });

    await engine.run({});
    expect(executed).toContain('step1');
    expect(executed).not.toContain('step2');
  });
});

describe('OrchestrationEngine - rollback', () => {
  it('should trigger rollback when stage fails', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });
    let rollbackCalled = false;

    engine.addStage({
      id: 'rollback_step',
      type: 'rollback',
      deps: [],
      handler: async () => {
        rollbackCalled = true;
      },
    });

    engine.addStage({
      id: 'failing_step',
      policy: {
        maxRetries: 0,
        retryDelayMs: 0,
        timeoutMs: 5000,
        rollbackStageId: 'rollback_step',
      },
      handler: async () => {
        throw new Error('Step failed');
      },
    });

    await expect(engine.run({})).rejects.toThrow('Step failed');
    expect(rollbackCalled).toBe(true);
    expect(engine.getMetrics().rollbackCount).toBe(1);
  });
});

describe('DependencyGraph - cycle detection', () => {
  it('should throw error for cyclic dependencies', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({ id: 'a', deps: ['b'], handler: async () => {} });
    engine.addStage({ id: 'b', deps: ['a'], handler: async () => {} });

    await expect(engine.run({})).rejects.toThrow(/cycle/i);
  });
});
describe('OrchestrationEngine - re-planning', () => {
  it('should reset stage and dependents when replanned', async () => {
    const engine = new OrchestrationEngine({ name: 'test' });

    engine.addStage({
      id: 'step1',
      handler: async () => ({ value: 1 }),
    });

    engine.addStage({
      id: 'step2',
      deps: ['step1'],
      handler: async (ctx) => ({ doubled: ctx.value * 2 }),
    });

    // Run pipeline first time
    await engine.run({});
    expect(engine.getStageStatus('step1')).toBe('COMPLETED');
    expect(engine.getStageStatus('step2')).toBe('COMPLETED');

    // Replan step1 - should also reset step2
    const affected = engine.replan(['step1']);
    expect(affected).toContain('step1');
    expect(affected).toContain('step2');
    expect(engine.getStageStatus('step1')).toBe('PENDING');
    expect(engine.getStageStatus('step2')).toBe('PENDING');
  });
});