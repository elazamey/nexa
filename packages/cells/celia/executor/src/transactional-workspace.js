/**
 * NEXA OS v0.6 — Transactional Workspace Cell
 * 
 * Pure cell logic — no direct fs, receives workspacePort injected from tools/
 * Staging / Copy-on-Write FS with atomic commit/rollback
 */

import { OmegaError } from '../../../../compiler/index.js';

export const WorkspaceStatus = Object.freeze({
  NONE: 'NONE',
  CREATING: 'CREATING',
  STAGING: 'STAGING',
  VERIFYING: 'VERIFYING',
  COMMITTING: 'COMMITTING',
  COMMITTED: 'COMMITTED',
  ROLLING_BACK: 'ROLLING_BACK',
  ROLLED_BACK: 'ROLLED_BACK',
  FAILED: 'FAILED'
});

export function createTransactionalWorkspaceCell({ identity, workspacePort, ledger } = {}) {
  if (!identity) throw new OmegaError('OMEGA_E_IDENTITY', 'workspace cell needs identity');
  if (!workspacePort || typeof workspacePort.createWorkspace !== 'function') {
    throw new OmegaError('OMEGA_E_MEMBRANE', 'workspace cell needs workspacePort { createWorkspace, writeFile, readFile, listChanges, commit, rollback }');
  }

  const workspaces = new Map(); // workspaceId → { status, taskId, changes, createdAt }

  return {
    id: identity.kid,
    status: WorkspaceStatus.NONE,

    receptors: {
      async create({ payload, evidenceRef } = {}) {
        if (!payload || !payload.taskId) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'workspace create needs { taskId }');
        }

        const workspaceId = `ws_${payload.taskId}_${Date.now().toString(36)}`;
        workspaces.set(workspaceId, {
          id: workspaceId,
          taskId: payload.taskId,
          status: WorkspaceStatus.CREATING,
          changes: [],
          createdAt: Date.now(),
          evidenceRef
        });

        const result = await workspacePort.createWorkspace(payload.taskId, { evidenceRef, workspaceId });

        const ws = workspaces.get(workspaceId);
        ws.status = WorkspaceStatus.STAGING;
        ws.realPath = result.realPath;
        ws.stagingPath = result.stagingPath;

        if (ledger) {
          ledger.record({
            kind: 'WORKSPACE_CREATED',
            workspaceId,
            taskId: payload.taskId,
            evidence_ref: evidenceRef,
            stagingPath: result.stagingPath
          });
        }

        return { ok: true, workspaceId, status: ws.status, stagingPath: result.stagingPath };
      },

      async write({ payload, evidenceRef } = {}) {
        if (!payload || !payload.workspaceId || !payload.path) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'workspace write needs { workspaceId, path, content }');
        }

        const ws = workspaces.get(payload.workspaceId);
        if (!ws) throw new OmegaError('OMEGA_E_NOT_FOUND', `workspace not found: ${payload.workspaceId}`);
        if (ws.status !== WorkspaceStatus.STAGING) {
          throw new OmegaError('OMEGA_E_STATE', `workspace not in STAGING: ${ws.status}`);
        }

        const result = await workspacePort.writeFile(payload.workspaceId, payload.path, payload.content, evidenceRef);

        ws.changes.push({
          path: payload.path,
          digest: result.digest,
          evidenceRef,
          timestamp: Date.now()
        });

        if (ledger) {
          ledger.record({
            kind: 'WORKSPACE_WRITE',
            workspaceId: payload.workspaceId,
            path: payload.path,
            digest: result.digest,
            evidence_ref: evidenceRef
          });
        }

        return { ok: true, workspaceId: payload.workspaceId, path: payload.path, digest: result.digest };
      },

      async read({ payload } = {}) {
        if (!payload || !payload.workspaceId || !payload.path) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'workspace read needs { workspaceId, path }');
        }

        const ws = workspaces.get(payload.workspaceId);
        if (!ws) throw new OmegaError('OMEGA_E_NOT_FOUND', `workspace not found: ${payload.workspaceId}`);

        const result = await workspacePort.readFile(payload.workspaceId, payload.path);
        return { ok: true, workspaceId: payload.workspaceId, path: payload.path, content: result.content, digest: result.digest };
      },

      async listChanges({ payload } = {}) {
        if (!payload || !payload.workspaceId) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'listChanges needs { workspaceId }');
        }

        const ws = workspaces.get(payload.workspaceId);
        if (!ws) throw new OmegaError('OMEGA_E_NOT_FOUND', `workspace not found: ${payload.workspaceId}`);

        const changes = await workspacePort.listChanges(payload.workspaceId);
        return { ok: true, workspaceId: payload.workspaceId, changes, count: changes.length };
      },

      async commit({ payload, evidenceRef } = {}) {
        if (!payload || !payload.workspaceId) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'commit needs { workspaceId }');
        }

        const ws = workspaces.get(payload.workspaceId);
        if (!ws) throw new OmegaError('OMEGA_E_NOT_FOUND', `workspace not found: ${payload.workspaceId}`);

        ws.status = WorkspaceStatus.COMMITTING;

        const result = await workspacePort.commit(payload.workspaceId, evidenceRef);

        ws.status = WorkspaceStatus.COMMITTED;
        ws.committedAt = Date.now();

        if (ledger) {
          ledger.record({
            kind: 'WORKSPACE_COMMIT',
            workspaceId: payload.workspaceId,
            evidence_ref: evidenceRef,
            changedFiles: result.changedFiles
          });
        }

        return { ok: true, workspaceId: payload.workspaceId, status: ws.status, changedFiles: result.changedFiles };
      },

      async rollback({ payload, evidenceRef } = {}) {
        if (!payload || !payload.workspaceId) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'rollback needs { workspaceId }');
        }

        const ws = workspaces.get(payload.workspaceId);
        if (!ws) throw new OmegaError('OMEGA_E_NOT_FOUND', `workspace not found: ${payload.workspaceId}`);

        ws.status = WorkspaceStatus.ROLLING_BACK;

        const result = await workspacePort.rollback(payload.workspaceId, evidenceRef);

        ws.status = WorkspaceStatus.ROLLED_BACK;
        ws.rolledBackAt = Date.now();

        if (ledger) {
          ledger.record({
            kind: 'WORKSPACE_ROLLBACK',
            workspaceId: payload.workspaceId,
            evidence_ref: evidenceRef,
            reason: payload.reason || 'rollback requested'
          });
        }

        return { ok: true, workspaceId: payload.workspaceId, status: ws.status, cleaned: result.cleaned };
      },

      async status({ payload } = {}) {
        if (payload && payload.workspaceId) {
          const ws = workspaces.get(payload.workspaceId);
          if (!ws) return { ok: false, error: 'not found' };
          const changes = await workspacePort.listChanges(payload.workspaceId).catch(() => []);
          return { ok: true, workspace: { ...ws, changes } };
        }

        // List all workspaces
        const all = [...workspaces.values()].map(ws => ({
          id: ws.id,
          taskId: ws.taskId,
          status: ws.status,
          changesCount: ws.changes.length,
          createdAt: ws.createdAt
        }));
        return { ok: true, workspaces: all, count: all.length };
      }
    },

    // Expose for tests
    _workspaces: workspaces
  };
}
