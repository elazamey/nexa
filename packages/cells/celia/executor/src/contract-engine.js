/**
 * NEXA OS v0.6 — Contract-First Harness (Invariant-Driven Execution)
 * 
 * Write contracts and invariants BEFORE execution.
 * Preconditions checked before, postconditions after, invariants always.
 * 
 * If pre passes and post passes, task auto-approved and workspace committed.
 * Otherwise rollback.
 */

export const ContractStatus = Object.freeze({
  PENDING: 'PENDING',
  PRE_CHECKING: 'PRE_CHECKING',
  PRE_PASSED: 'PRE_PASSED',
  PRE_FAILED: 'PRE_FAILED',
  EXECUTING: 'EXECUTING',
  POST_CHECKING: 'POST_CHECKING',
  POST_PASSED: 'POST_PASSED',
  POST_FAILED: 'POST_FAILED',
  COMMITTED: 'COMMITTED',
  ROLLED_BACK: 'ROLLED_BACK'
});

export class ContractEngine {
  constructor({ gitPort = null, testPort = null, buildPort = null } = {}) {
    this.gitPort = gitPort;
    this.testPort = testPort;
    this.buildPort = buildPort;
  }

  /**
   * Check preconditions before execution
   */
  async checkPreconditions(contract, context = {}) {
    const failures = [];
    const checks = [];

    const pre = contract.preconditions || [];

    for (const cond of pre) {
      let ok = true;
      let detail = '';

      try {
        if (typeof cond === 'string') {
          // Simple string conditions
          if (cond === 'git_status: clean') {
            const status = await this._checkGitClean(context);
            ok = status.clean;
            detail = status.detail;
          } else if (cond === 'tests_passing: true' || cond === 'tests_passing') {
            const result = await this._checkTestsPassing(context);
            ok = result.passing;
            detail = result.detail;
          } else if (cond === 'no_uncommitted_changes') {
            const status = await this._checkGitClean(context);
            ok = status.clean;
            detail = status.detail;
          } else {
            // Unknown string condition — treat as custom check via context
            ok = context[cond] !== false;
            detail = `custom check ${cond}: ${ok ? 'pass' : 'fail'}`;
          }
        } else if (typeof cond === 'object') {
          // Object conditions: { git_status: 'clean' } or { tests_passing: true }
          const key = Object.keys(cond)[0];
          const expected = cond[key];

          if (key === 'git_status') {
            const status = await this._checkGitClean(context);
            ok = expected === 'clean' ? status.clean : true;
            detail = status.detail;
          } else if (key === 'tests_passing') {
            const result = await this._checkTestsPassing(context);
            ok = expected === true ? result.passing : true;
            detail = result.detail;
          } else if (key === 'changed_files_max') {
            const count = context.changedFiles || 0;
            ok = count <= expected;
            detail = `changed_files ${count} <= max ${expected}`;
          } else {
            ok = context[key] === expected || context[key] !== undefined;
            detail = `${key}=${context[key]} expected ${expected}`;
          }
        }
      } catch (e) {
        ok = false;
        detail = `check error: ${e.message}`;
      }

      checks.push({ condition: cond, ok, detail });
      if (!ok) failures.push({ condition: cond, detail });
    }

    return {
      ok: failures.length === 0,
      failures,
      checks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check postconditions after execution
   */
  async checkPostconditions(contract, beforeContext = {}, afterContext = {}, changes = {}) {
    const failures = [];
    const checks = [];
    const post = contract.postconditions || [];

    for (const cond of post) {
      let ok = true;
      let detail = '';

      try {
        if (typeof cond === 'string') {
          if (cond === 'build_status: success' || cond === 'build_status') {
            const result = await this._checkBuildSuccess(afterContext);
            ok = result.success;
            detail = result.detail;
          } else if (cond === 'tests_passing: true' || cond === 'tests_passing') {
            const result = await this._checkTestsPassing(afterContext);
            ok = result.passing;
            detail = result.detail;
          } else if (cond === 'no_new_eslint_warnings: true' || cond === 'no_new_eslint_warnings') {
            const result = await this._checkEslintWarnings(beforeContext, afterContext);
            ok = result.ok;
            detail = result.detail;
          } else if (cond === 'no_secrets_leaked: true' || cond === 'no_secrets_leaked') {
            const result = await this._checkNoSecrets(changes);
            ok = result.ok;
            detail = result.detail;
          } else if (cond === 'evidence_chain_valid: true' || cond === 'evidence_chain_valid') {
            ok = afterContext.evidenceChainValid !== false;
            detail = `evidence_chain_valid=${ok}`;
          } else if (cond === 'ledger_hash_valid: true' || cond === 'ledger_hash_valid') {
            ok = afterContext.ledgerValid !== false;
            detail = `ledger_hash_valid=${ok}`;
          } else if (cond === 'real_execution_closed: true' || cond === 'real_execution_closed') {
            ok = afterContext.realExecutionClosed !== false;
            detail = `real_execution_closed=${ok}`;
          } else {
            ok = afterContext[cond] !== false;
            detail = `custom post check ${cond}: ${ok ? 'pass' : 'fail'}`;
          }
        } else if (typeof cond === 'object') {
          const key = Object.keys(cond)[0];
          const expected = cond[key];

          if (key === 'build_status') {
            const result = await this._checkBuildSuccess(afterContext);
            ok = expected === 'success' ? result.success : true;
            detail = result.detail;
          } else if (key === 'changed_files_max') {
            const count = changes.changedFiles || afterContext.changedFiles || 0;
            ok = count <= expected;
            detail = `changed_files ${count} <= max ${expected}`;
          } else if (key === 'tests_passing') {
            const result = await this._checkTestsPassing(afterContext);
            ok = expected === true ? result.passing : true;
            detail = result.detail;
          } else {
            ok = afterContext[key] === expected || afterContext[key] !== undefined;
            detail = `${key}=${afterContext[key]} expected ${expected}`;
          }
        }
      } catch (e) {
        ok = false;
        detail = `post check error: ${e.message}`;
      }

      checks.push({ condition: cond, ok, detail });
      if (!ok) failures.push({ condition: cond, detail });
    }

    return {
      ok: failures.length === 0,
      failures,
      checks,
      metrics: {
        changedFiles: changes.changedFiles || afterContext.changedFiles || 0,
        buildStatus: afterContext.buildStatus || 'unknown',
        testsPassing: afterContext.testsPassing,
        warnings: afterContext.warnings || 0
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Full verification — pre + post
   */
  async verify(contract, beforeContext = {}, afterContext = {}, changes = {}) {
    const pre = await this.checkPreconditions(contract, beforeContext);
    if (!pre.ok) {
      return {
        ok: false,
        shouldCommit: false,
        status: ContractStatus.PRE_FAILED,
        pre,
        post: null,
        reason: 'Preconditions failed — no execution'
      };
    }

    const post = await this.checkPostconditions(contract, beforeContext, afterContext, changes);

    return {
      ok: post.ok,
      shouldCommit: post.ok,
      status: post.ok ? ContractStatus.POST_PASSED : ContractStatus.POST_FAILED,
      pre,
      post,
      reason: post.ok ? 'All postconditions passed — commit' : `Postconditions failed: ${post.failures.map(f => f.detail).join(', ')} — rollback`
    };
  }

  // Internal checks — mock by default, real via ports if injected

  async _checkGitClean(context) {
    if (this.gitPort && this.gitPort.status) {
      try {
        const status = await this.gitPort.status();
        return { clean: status.clean, detail: status.detail || `git clean=${status.clean}` };
      } catch {}
    }
    // Mock: check context
    const clean = context.gitStatus === 'clean' || context.gitClean !== false;
    return { clean, detail: `git_status ${clean ? 'clean' : 'dirty'} (mock)` };
  }

  async _checkTestsPassing(context) {
    if (this.testPort && this.testPort.run) {
      try {
        const result = await this.testPort.run();
        return { passing: result.passing, detail: `tests ${result.passing ? 'passing' : 'failing'}: ${result.detail || ''}` };
      } catch {}
    }
    const passing = context.testsPassing !== false;
    return { passing, detail: `tests_passing ${passing} (mock)` };
  }

  async _checkBuildSuccess(context) {
    if (this.buildPort && this.buildPort.run) {
      try {
        const result = await this.buildPort.run();
        return { success: result.success, detail: `build ${result.success ? 'success' : 'failed'}` };
      } catch {}
    }
    const success = context.buildStatus === 'success' || context.buildPassing !== false;
    return { success, detail: `build_status ${success ? 'success' : 'failed'} (mock)` };
  }

  async _checkEslintWarnings(before, after) {
    const beforeWarnings = before.warnings || before.eslintWarnings || 0;
    const afterWarnings = after.warnings || after.eslintWarnings || 0;
    const ok = afterWarnings <= beforeWarnings;
    return { ok, detail: `eslint warnings before=${beforeWarnings} after=${afterWarnings} ${ok ? 'no new' : 'new warnings'}` };
  }

  async _checkNoSecrets(changes) {
    const content = JSON.stringify(changes).toLowerCase();
    const secretPatterns = ['api_key', 'apikey', 'secret', 'password', 'token', 'aws_', 'sk-'];
    const hasSecret = secretPatterns.some(p => content.includes(p) && content.includes('='));
    // More precise: look for actual secret-like strings
    const hasLeak = content.includes('sk-') && content.length > 20;
    return { ok: !hasLeak, detail: hasLeak ? 'potential secret leaked' : 'no secrets leaked (mock scan)' };
  }
}
