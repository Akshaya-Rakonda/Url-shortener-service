'use strict';

const { EventEmitter } = require('eventemitter3');
const { v4: uuidv4 } = require('uuid');
const DependencyGraph = require('./dependencyGraph');

/**
 * OrchestrationEngine
 * 
 * Executes a pipeline of stages defined as a DAG.
 * Supports:
 * - Parallel and sequential execution
 * - Retry with exponential backoff
 * - Human approval gates
 * - Rollback on failure
 * - Safe stop
 * - Audit logging
 * - Reliability metrics
 */
class OrchestrationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.graph = new DependencyGraph();
    this.executionId = uuidv4();
    this.name = options.name || 'unnamed-pipeline';
    this.requireHumanApproval = options.requireHumanApproval || false;

    
    this._context = {};

    
    this._stageResults = new Map();

   
    this._stageStatuses = new Map();

    
    this._auditLog = [];

    
    this._metrics = {
      startTime: null,
      endTime: null,
      e2eLatencyMs: null,
      stagesCompleted: 0,
      stagesFailed: 0,
      retryCount: 0,
      rollbackCount: 0,
      successRate: null,
    };

    
    this._safeStopRequested = false;

    
    this._approvalCallbacks = new Map();
  }

  
  addStage(stage) {
    this.graph.addStage(stage);
    return this;
  }

  
  async run(initialContext = {}) {

    
    const validation = this.graph.validate();
    if (!validation.valid) {
      throw new Error(`Invalid pipeline: ${validation.errors.join(', ')}`);
    }

    this._context = { ...initialContext };
    this._metrics.startTime = Date.now();

    this._addAuditEntry('pipeline_started', null, {
      executionId: this.executionId,
      pipeline: this.name,
    });

    this.emit('pipeline:start', {
      executionId: this.executionId,
    });

    
    const layers = this.graph.computeExecutionOrder();

    try {
      for (const layer of layers) {

        
        if (this._safeStopRequested) {
          this._addAuditEntry('pipeline_safe_stopped', null, {});
          this.emit('pipeline:safe_stop', { executionId: this.executionId });
          break;
        }

        await this._executeLayer(layer);
      }
    } catch (err) {
      this._metrics.stagesFailed++;
      this._addAuditEntry('pipeline_failed', null, { error: err.message });
      this.emit('pipeline:failed', { executionId: this.executionId, error: err });
      throw err;
    }

    
    this._metrics.endTime = Date.now();
    this._metrics.e2eLatencyMs = this._metrics.endTime - this._metrics.startTime;
    this._metrics.successRate = this._calculateSuccessRate();

    this._addAuditEntry('pipeline_completed', null, {
      e2eLatencyMs: this._metrics.e2eLatencyMs,
      stagesCompleted: this._metrics.stagesCompleted,
    });

    this.emit('pipeline:complete', {
      executionId: this.executionId,
      context: this._context,
      metrics: this._metrics,
    });

    return {
      executionId: this.executionId,
      context: this._context,
      stageResults: Object.fromEntries(this._stageResults),
      auditLog: this._auditLog,
      metrics: this._metrics,
    };
  }

  
  async _executeLayer(stageIds) {
    const stages = stageIds.map(id => this.graph.nodes.get(id));

    const parallelStages = stages.filter(s => s.parallel);
    const sequentialStages = stages.filter(s => !s.parallel);

    
    if (parallelStages.length > 0) {
      await Promise.all(parallelStages.map(s => this._executeStage(s)));
    }

    
    for (const stage of sequentialStages) {
      await this._executeStage(stage);
    }
  }

  
  async _executeStage(stage) {

    
    if (this._safeStopRequested) {
      this._setStageStatus(stage.id, 'SAFE_STOPPED');
      return;
    }

    
    if (stage.requiresApproval && this.requireHumanApproval) {
      await this._waitForApproval(stage);
    }

    this._setStageStatus(stage.id, 'RUNNING');
    const stageStart = Date.now();
    let attempt = 0;
    const { maxRetries, retryDelayMs, timeoutMs } = stage.policy;

    while (attempt <= maxRetries) {
      try {
        
        const result = await this._withTimeout(
          stage.handler(this._context, this._stageResults),
          timeoutMs,
          stage.id
        );

        
        if (result && typeof result === 'object') {
          Object.assign(this._context, result);
        }

        this._stageResults.set(stage.id, result);
        this._setStageStatus(stage.id, 'COMPLETED');
        this._metrics.stagesCompleted++;

        this._addAuditEntry('stage_completed', stage.id, {
          attempt,
          latencyMs: Date.now() - stageStart,
        });

        this.emit('stage:complete', { stageId: stage.id, attempt });
        return;

      } catch (err) {
        attempt++;

        if (attempt <= maxRetries) {
          
          const delay = retryDelayMs * Math.pow(2, attempt - 1);
          this._setStageStatus(stage.id, 'RETRYING');
          this._metrics.retryCount++;

          this._addAuditEntry('stage_retrying', stage.id, {
            attempt,
            delayMs: delay,
            error: err.message,
          });

          this.emit('stage:retry', { stageId: stage.id, attempt, error: err });
          await this._sleep(delay);
        } else {
          
          this._setStageStatus(stage.id, 'FAILED');

          this._addAuditEntry('stage_failed', stage.id, {
            attempt,
            error: err.message,
            latencyMs: Date.now() - stageStart,
          });

          this.emit('stage:failed', { stageId: stage.id, error: err });

          
          if (stage.policy.rollbackStageId) {
            await this._executeRollback(stage.policy.rollbackStageId, err);
          }

          throw err;
        }
      }
    }
  }

  
  async _executeRollback(rollbackStageId, originalError) {
    const rollbackStage = this.graph.nodes.get(rollbackStageId);
    if (!rollbackStage) { return; }

    this._addAuditEntry('rollback_started', rollbackStageId, {
      triggeredBy: originalError.message,
    });

    this.emit('rollback:start', { rollbackStageId });

    try {
      await rollbackStage.handler(this._context, this._stageResults);
      this._setStageStatus(rollbackStageId, 'ROLLED_BACK');
      this._metrics.rollbackCount++;
      this._addAuditEntry('rollback_completed', rollbackStageId, {});
      this.emit('rollback:complete', { rollbackStageId });
    } catch (err) {
      this._addAuditEntry('rollback_failed', rollbackStageId, { error: err.message });
      this.emit('rollback:failed', { rollbackStageId, error: err });
    }
  }

  
  _waitForApproval(stage) {
    this._setStageStatus(stage.id, 'AWAITING_APPROVAL');
    this._addAuditEntry('stage_awaiting_approval', stage.id, {
      message: `Waiting for human approval on stage '${stage.name}'`,
    });

    this.emit('stage:awaiting_approval', {
      stageId: stage.id,
      stageName: stage.name,
      executionId: this.executionId,
    });

    return new Promise((resolve, reject) => {
      this._approvalCallbacks.set(stage.id, { resolve, reject });
    });
  }

  
  approve(stageId, approverInfo = {}) {
    const cb = this._approvalCallbacks.get(stageId);
    if (!cb) {
      throw new Error(`No approval pending for stage '${stageId}'`);
    }
    this._addAuditEntry('stage_approved', stageId, { approver: approverInfo });
    this.emit('stage:approved', { stageId, approverInfo });
    this._setStageStatus(stageId, 'APPROVED');
    this._approvalCallbacks.delete(stageId);
    cb.resolve();
  }

  
  reject(stageId, reason = 'Rejected by human') {
    const cb = this._approvalCallbacks.get(stageId);
    if (!cb) {
      throw new Error(`No approval pending for stage '${stageId}'`);
    }
    this._addAuditEntry('stage_rejected', stageId, { reason });
    this.emit('stage:rejected', { stageId, reason });
    this._approvalCallbacks.delete(stageId);
    cb.reject(Object.assign(new Error(reason), { code: 'HUMAN_REJECTED' }));
  }

  
  safeStop(reason = 'Operator requested stop') {
    this._safeStopRequested = true;
    this._addAuditEntry('safe_stop_requested', null, { reason });
    this.emit('pipeline:safe_stop_requested', { reason });
  }

  // Dynamically re-plan when upstream outputs change
  replan(changedStageIds = []) {
    const replanned = [];

    for (const stageId of changedStageIds) {
      if (this.graph.nodes.has(stageId)) {
        
        this._setStageStatus(stageId, 'PENDING');

        
        this._stageResults.delete(stageId);

        
        for (const [id, deps] of this.graph.edges) {
          if (deps.has(stageId)) {
            this._setStageStatus(id, 'PENDING');
            this._stageResults.delete(id);
            replanned.push(id);
          }
        }

        replanned.push(stageId);

        this._addAuditEntry('stage_replanned', stageId, {
          reason: 'upstream output changed',
          affectedStages: replanned,
        });

        this.emit('pipeline:replanned', {
          changedStageId: stageId,
          affectedStages: replanned,
        });
      }
    }

    return replanned;
  }

  
  getAuditLog() {
    return [...this._auditLog];
  }

  
  getMetrics() {
    return { ...this._metrics };
  }

  
  getStageStatus(stageId) {
    return this._stageStatuses.get(stageId) || 'PENDING';
  }

  

  _setStageStatus(stageId, status) {
    this._stageStatuses.set(stageId, status);
  }

  _addAuditEntry(event, stageId, data = {}) {
    this._auditLog.push({
      ts: new Date().toISOString(),
      executionId: this.executionId,
      pipeline: this.name,
      event,
      stageId: stageId || null,
      ...data,
    });
  }

  _calculateSuccessRate() {
    const total = this._metrics.stagesCompleted + this._metrics.stagesFailed;
    if (total === 0) { return 1.0; }
    return this._metrics.stagesCompleted / total;
  }

  _withTimeout(promise, ms, stageId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(
          new Error(`Stage '${stageId}' timed out after ${ms}ms`),
          { code: 'TIMEOUT' }
        ));
      }, ms);
      promise.then(
        val => { clearTimeout(timer); resolve(val); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { OrchestrationEngine };