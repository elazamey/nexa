/**
 * Celia API Server — SSE for DAG streaming (v0.4)
 * 
 * This module lives in packages/cells/celia/api/ but does NOT import
 * ambient authority directly — it receives ports. The actual HTTP server
 * lives in tools/ (allowed to use net).
 * 
 * Exports dagEventEmitter for executor to emit updates.
 */

import { EventEmitter } from 'node:events';

export const dagEventEmitter = new EventEmitter();

// Increase max listeners for parallel DAG nodes
dagEventEmitter.setMaxListeners(50);

/**
 * Helper to emit node state changes
 * @param {string} nodeId - DAG node id
 * @param {string} state - PENDING, RUNNING, SUCCESS, FAILED
 * @param {string|null} evidenceRef - evidence hash
 */
export function updateNodeState(nodeId, state, evidenceRef = null) {
  dagEventEmitter.emit('dag_update', {
    type: 'NODE_STATE_CHANGE',
    payload: { nodeId, state, evidenceRef, timestamp: Date.now() }
  });
}

export function emitDagEvent(type, payload) {
  dagEventEmitter.emit('dag_update', { type, payload: { ...payload, timestamp: Date.now() } });
}
