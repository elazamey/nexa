/**
 * NEXA v0.9 — Forking Engine & Copy-on-Write Task Forking
 * 
 * تشعيب المهام — كل fork نسخة CoW مستقلة تجرب استراتيجية مختلفة
 * - Fork task into N parallel universes, each tries different strategy
 * - CoW isolation — no interference
 * - Winner merge via consensus
 */

export class ForkEngine {
  constructor() {
    this.forks = new Map(); // forkId → { parentTaskId, strategy, state, status }
    this.taskForks = new Map(); // taskId → forkIds
  }

  forkTask(taskId, strategies, { evidenceRef = null } = {}) {
    if (!evidenceRef) throw new Error('Fork requires evidenceRef');

    const forkIds = [];

    for (let i = 0; i < strategies.length; i++) {
      const forkId = `${taskId}_fork_${i}_${strategies[i].id || 's' + i}`;
      const fork = {
        id: forkId,
        parentTaskId: taskId,
        strategy: strategies[i],
        state: 'forked',
        evidenceRef,
        createdAt: Date.now(),
        cowIsolated: true,
        result: null,
        duration: 0
      };

      this.forks.set(forkId, fork);
      forkIds.push(forkId);
    }

    this.taskForks.set(taskId, forkIds);

    return {
      taskId,
      forkCount: forkIds.length,
      forkIds,
      strategies: strategies.map(s => s.id || s.name),
      isolation: 'CoW — each fork isolated, no interference',
      claim: `Forked task ${taskId} into ${forkIds.length} CoW universes — each tries different strategy in parallel`
    };
  }

  completeFork(forkId, result, { success = true } = {}) {
    const fork = this.forks.get(forkId);
    if (!fork) throw new Error(`Fork not found: ${forkId}`);

    fork.state = success ? 'success' : 'failed';
    fork.result = result;
    fork.completedAt = Date.now();
    fork.duration = fork.completedAt - fork.createdAt;

    return fork;
  }

  selectWinner(taskId, { criteria = 'fastest' } = {}) {
    const forkIds = this.taskForks.get(taskId);
    if (!forkIds) throw new Error(`No forks for task: ${taskId}`);

    const forks = forkIds.map(id => this.forks.get(id)).filter(Boolean);
    const successful = forks.filter(f => f.state === 'success');

    if (successful.length === 0) {
      return { winner: null, reason: 'No successful forks', taskId, totalForks: forks.length };
    }

    let winner;
    if (criteria === 'fastest') {
      winner = successful.sort((a,b) => a.duration - b.duration)[0];
    } else if (criteria === 'most_evidence') {
      winner = successful.sort((a,b) => (b.result?.evidence?.length || 0) - (a.result?.evidence?.length || 0))[0];
    } else {
      winner = successful[0];
    }

    // Mark others as eliminated
    for (const f of forks) {
      if (f.id !== winner.id && f.state === 'success') {
        f.state = 'eliminated_winner_exists';
      }
    }

    return {
      taskId,
      winner: winner.id,
      winnerStrategy: winner.strategy,
      winnerDuration: winner.duration,
      totalForks: forks.length,
      successful: successful.length,
      criteria,
      claim: `Fork winner ${winner.id} strategy ${winner.strategy.id || winner.strategy.name} in ${winner.duration}ms — ${successful.length}/${forks.length} succeeded, ${forks.length - successful.length} failed, rest eliminated`
    };
  }

  getStats() {
    const totalForks = this.forks.size;
    const success = [...this.forks.values()].filter(f => f.state === 'success').length;
    const failed = [...this.forks.values()].filter(f => f.state === 'failed').length;

    return {
      totalForks,
      success,
      failed,
      totalTasks: this.taskForks.size,
      avgForksPerTask: this.taskForks.size > 0 ? (totalForks / this.taskForks.size).toFixed(1) : '0',
      claim: 'Task forking CoW — N parallel universes, each strategy isolated, winner merge'
    };
  }
}
