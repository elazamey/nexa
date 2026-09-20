/**
 * NEXA OS v0.6 — Time-Travel Debugging & Deterministic Replay (Event Sourcing)
 * 
 * Full Event Sourcing for all inputs/outputs and env.
 * Record every tool output, response code, with fixed random seeds.
 * If task fails at step 42, kernel can replay from step 39 with one param change
 * without re-calling LLM for steps 1-38, saving cost/time and making debugging 100% accurate.
 */

import crypto from 'node:crypto';

export const EventType = Object.freeze({
  DAG_START: 'DAG_START',
  DAG_COMPLETE: 'DAG_COMPLETE',
  DAG_FAILED: 'DAG_FAILED',
  DAG_NODE_INJECTED: 'DAG_NODE_INJECTED',
  NODE_START: 'NODE_START',
  NODE_COMPLETE: 'NODE_COMPLETE',
  NODE_FAILED: 'NODE_FAILED',
  TOOL_CALL: 'TOOL_CALL',
  TOOL_OUTPUT: 'TOOL_OUTPUT',
  WORKSPACE_CREATED: 'WORKSPACE_CREATED',
  WORKSPACE_COMMIT: 'WORKSPACE_COMMIT',
  WORKSPACE_ROLLBACK: 'WORKSPACE_ROLLBACK',
  CONTRACT_CHECK_PRE: 'CONTRACT_CHECK_PRE',
  CONTRACT_CHECK_POST: 'CONTRACT_CHECK_POST',
  MEMORY_RECALLED: 'MEMORY_RECALLED',
  MEMORY_REGISTERED: 'MEMORY_REGISTERED',
  BELIEF_REVISED: 'BELIEF_REVISED',
  FORGETTING_SWEEP: 'FORGETTING_SWEEP',
  LEDGER_ENTRY: 'LEDGER_ENTRY',
  CHECKPOINT: 'CHECKPOINT'
});

export class EventSourcingEngine {
  constructor({ maxEvents = 10000, seed = null } = {}) {
    this.log = [];
    this.maxEvents = maxEvents;
    this.seed = seed || crypto.randomBytes(8).toString('hex');
    this.env = {
      nodeVersion: process.version,
      platform: process.platform,
      seed: this.seed,
      startedAt: new Date().toISOString()
    };

    this.checkpoints = new Map(); // index → state snapshot
  }

  /**
   * Record event — hash-chained, append-only
   */
  record(eventType, payload = {}, evidenceRef = null) {
    if (!Object.values(EventType).includes(eventType) && !eventType.includes('_')) {
      console.warn(`[event-sourcing] unknown event type: ${eventType}`);
    }

    const prevHash = this.log.length > 0 ? this.log[this.log.length - 1].hash : 'GENESIS';

    const event = {
      index: this.log.length,
      timestamp: new Date().toISOString(),
      type: eventType,
      payload,
      evidenceRef: evidenceRef || payload.evidenceRef || null,
      prevHash,
      hash: null,
      seed: this.seed
    };

    const withoutHash = { ...event, hash: undefined };
    event.hash = crypto.createHash('sha256')
      .update(prevHash + JSON.stringify(withoutHash))
      .digest('hex');

    this.log.push(event);

    // Enforce max
    if (this.log.length > this.maxEvents) {
      const excess = this.log.length - this.maxEvents;
      this.log.splice(1, excess);
      this.log.forEach((e, i) => e.index = i);
    }

    return event;
  }

  /**
   * Create checkpoint at current index — saves state snapshot
   */
  checkpoint(state, evidenceRef = null) {
    const index = this.log.length - 1;
    const snapshot = {
      index,
      timestamp: new Date().toISOString(),
      state: JSON.parse(JSON.stringify(state)), // deep clone
      evidenceRef,
      hash: this.log[index]?.hash || 'GENESIS'
    };
    this.checkpoints.set(index, snapshot);
    this.record(EventType.CHECKPOINT, { checkpointIndex: index, stateHash: snapshot.hash }, evidenceRef);
    return snapshot;
  }

  /**
   * Get state at index — reconstructs from events up to index
   */
  getStateAt(index) {
    if (index < 0 || index >= this.log.length) {
      throw new Error(`Index out of bounds: ${index}, log length ${this.log.length}`);
    }

    // Find nearest checkpoint before index
    let checkpointIndex = -1;
    let checkpoint = null;
    for (const [cpIndex, cp] of this.checkpoints.entries()) {
      if (cpIndex <= index && cpIndex > checkpointIndex) {
        checkpointIndex = cpIndex;
        checkpoint = cp;
      }
    }

    let state;
    let startFrom;

    if (checkpoint) {
      state = JSON.parse(JSON.stringify(checkpoint.state));
      startFrom = checkpointIndex + 1;
    } else {
      state = {
        dag: { nodes: [], edges: [], version: 1 },
        workspaces: [],
        memories: [],
        evidence: [],
        contracts: []
      };
      startFrom = 0;
    }

    // Replay events from checkpoint to index
    for (let i = startFrom; i <= index; i++) {
      const event = this.log[i];
      state = this._applyEvent(state, event);
    }

    return {
      index,
      state,
      checkpointIndex,
      eventsReplayed: index - startFrom + 1,
      hash: this.log[index].hash
    };
  }

  /**
   * Replay from index with overrides — no LLM calls for steps before index
   */
  replayFrom(index, overrides = {}, evidenceRef = null) {
    const { state, checkpointIndex } = this.getStateAt(index);

    // Apply overrides
    const newState = {
      ...state,
      ...overrides,
      replayedFrom: index,
      checkpointIndex,
      overrides,
      replayedAt: new Date().toISOString()
    };

    // Record replay event
    const replayEvent = this.record(EventType.DAG_START, {
      replayedFrom: index,
      checkpointIndex,
      overrides,
      dagId: `replay_${index}_${Date.now().toString(36)}`,
      isReplay: true
    }, evidenceRef);

    return {
      fromIndex: index,
      checkpointIndex,
      state: newState,
      replayEvent,
      message: `Replaying from ${index} (checkpoint ${checkpointIndex}) with overrides, no LLM calls for 0..${index-1}`
    };
  }

  /**
   * Get events with filter
   */
  getEvents({ from = 0, to = null, type = null, nodeId = null, limit = 100 } = {}) {
    let events = this.log;

    if (from) events = events.filter(e => e.index >= from);
    if (to !== null) events = events.filter(e => e.index <= to);
    if (type) events = events.filter(e => e.type === type);
    if (nodeId) events = events.filter(e => e.payload.nodeId === nodeId || e.payload.id === nodeId);

    return events.slice(-limit);
  }

  /**
   * Verify chain integrity
   */
  verifyChain() {
    if (this.log.length === 0) return { valid: true, entries: 0 };

    for (let i = 0; i < this.log.length; i++) {
      const event = this.log[i];
      const expectedPrevHash = i === 0 ? 'GENESIS' : this.log[i - 1].hash;

      if (event.prevHash !== expectedPrevHash) {
        return { valid: false, error: `prevHash mismatch at ${i}`, index: i };
      }

      const withoutHash = { ...event, hash: undefined };
      const expectedHash = crypto.createHash('sha256')
        .update(event.prevHash + JSON.stringify(withoutHash))
        .digest('hex');

      if (event.hash !== expectedHash) {
        return { valid: false, error: `hash tampered at ${i}`, index: i };
      }
    }

    return { valid: true, entries: this.log.length, genesis: this.log[0]?.hash, latest: this.log[this.log.length - 1]?.hash };
  }

  getStats() {
    const byType = {};
    for (const e of this.log) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    return {
      total: this.log.length,
      byType,
      checkpoints: this.checkpoints.size,
      seed: this.seed,
      env: this.env,
      valid: this.verifyChain().valid
    };
  }

  export() {
    return {
      log: this.log,
      checkpoints: [...this.checkpoints.entries()],
      seed: this.seed,
      env: this.env
    };
  }

  import(data) {
    this.log = data.log || [];
    this.checkpoints = new Map(data.checkpoints || []);
    this.seed = data.seed || this.seed;
    this.env = data.env || this.env;
    return this.verifyChain();
  }

  _applyEvent(state, event) {
    const newState = { ...state };

    switch (event.type) {
      case EventType.DAG_START:
        newState.dag = { ...newState.dag, id: event.payload.dagId || newState.dag.id, startedAt: event.timestamp };
        break;
      case EventType.NODE_START:
        newState.dag = {
          ...newState.dag,
          nodes: newState.dag.nodes.map(n => n.id === event.payload.nodeId ? { ...n, status: 'RUNNING' } : n)
        };
        break;
      case EventType.NODE_COMPLETE:
        newState.dag = {
          ...newState.dag,
          nodes: newState.dag.nodes.map(n => n.id === event.payload.nodeId ? { ...n, status: event.payload.state || 'SUCCESS' } : n)
        };
        break;
      case EventType.NODE_FAILED:
        newState.dag = {
          ...newState.dag,
          nodes: newState.dag.nodes.map(n => n.id === event.payload.nodeId ? { ...n, status: 'FAILED', error: event.payload.error } : n)
        };
        break;
      case EventType.DAG_NODE_INJECTED:
        if (event.payload.injected) {
          newState.dag = {
            ...newState.dag,
            nodes: [...newState.dag.nodes, ...event.payload.injected],
            version: (newState.dag.version || 1) + 1
          };
        }
        break;
      default:
        // Other events don't mutate core DAG state, just log
        break;
    }

    return newState;
  }
}
