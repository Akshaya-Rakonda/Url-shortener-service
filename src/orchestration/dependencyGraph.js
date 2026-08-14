'use strict';

/**
 * DependencyGraph
 * 
 * Manages a Directed Acyclic Graph (DAG) of pipeline stages.
 * Each stage can depend on other stages.
 * Computes execution order and detects cycles.
 */
class DependencyGraph {
  constructor() {
    this.nodes = new Map(); // stageId -> stage definition
    this.edges = new Map(); // stageId -> Set of dependency stageIds
  }

  
  addStage(stage) {
    if (this.nodes.has(stage.id)) {
      throw new Error(`Stage '${stage.id}' is already registered`);
    }

    this.nodes.set(stage.id, {
      id: stage.id,
      name: stage.name || stage.id,
      type: stage.type || 'task',
      handler: stage.handler,
      deps: stage.deps || [],
      parallel: stage.parallel || false,
      requiresApproval: stage.requiresApproval || false,
      policy: {
        maxRetries: stage.policy?.maxRetries ?? 3,
        retryDelayMs: stage.policy?.retryDelayMs ?? 1000,
        timeoutMs: stage.policy?.timeoutMs ?? 30000,
        rollbackStageId: stage.policy?.rollbackStageId || null,
      },
    });

    this.edges.set(stage.id, new Set(stage.deps || []));
  }

  
  computeExecutionOrder() {

    
    const inDegree = new Map();
    for (const id of this.nodes.keys()) {
      inDegree.set(id, 0);
    }

    for (const [id, deps] of this.edges) {
      for (const dep of deps) {
        if (!this.nodes.has(dep)) {
          throw new Error(`Unknown dependency '${dep}' in stage '${id}'`);
        }
      }
      inDegree.set(id, deps.size);
    }

    
    const successors = new Map();
    for (const id of this.nodes.keys()) {
      successors.set(id, new Set());
    }
    for (const [id, deps] of this.edges) {
      for (const dep of deps) {
        successors.get(dep).add(id);
      }
    }

    
    const layers = [];
    let queue = [...this.nodes.keys()].filter(id => inDegree.get(id) === 0);

    while (queue.length > 0) {
      layers.push([...queue]);
      const next = [];
      for (const id of queue) {
        for (const successor of successors.get(id)) {
          const newDegree = inDegree.get(successor) - 1;
          inDegree.set(successor, newDegree);
          if (newDegree === 0) {
            next.push(successor);
          }
        }
      }
      queue = next;
    }

    
    if (layers.flat().length !== this.nodes.size) {
      throw new Error('Dependency graph contains a cycle');
    }

    return layers;
  }

  
  validate() {
    const errors = [];
    try {
      this.computeExecutionOrder();
    } catch (err) {
      errors.push(err.message);
    }
    return { valid: errors.length === 0, errors };
  }
}

module.exports = DependencyGraph;