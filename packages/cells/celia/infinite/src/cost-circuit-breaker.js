/**
 * NEXA v0.9 — Cost Circuit Breaker & Budget Enforcement
 * 
 * قاطع دائرة التكلفة — يمنع انفجار الفواتير
 * - Track LLM tokens, compute, storage, egress costs per task
 * - Circuit breaker: if cost exceeds budget → halt, rollback
 * - Evidence-bound cost ledger
 */

export class CostCircuitBreakerEngine {
  constructor({ defaultBudget = 1.0 } = {}) { // $1.00 default
    this.budgets = new Map(); // taskId → { budget, spent, breakdown }
    this.defaultBudget = defaultBudget;
    this.breakers = []; // tripped breakers
    this.totalSpent = 0;
  }

  setBudget(taskId, budget, { evidenceRef = null } = {}) {
    if (!evidenceRef) throw new Error('Budget requires evidenceRef');

    const record = {
      taskId,
      budget,
      spent: 0,
      breakdown: { llm: 0, compute: 0, storage: 0, egress: 0 },
      evidenceRef,
      status: 'active',
      createdAt: Date.now()
    };

    this.budgets.set(taskId, record);
    return record;
  }

  recordCost(taskId, { type, amount, tokens = 0, evidenceRef = null } = {}) {
    let budget = this.budgets.get(taskId);
    if (!budget) {
      budget = this.setBudget(taskId, this.defaultBudget, { evidenceRef: evidenceRef || 'auto_budget' });
    }

    budget.spent += amount;
    budget.breakdown[type] = (budget.breakdown[type] || 0) + amount;
    this.totalSpent += amount;

    const remaining = budget.budget - budget.spent;
    const percentUsed = (budget.spent / budget.budget * 100).toFixed(1);

    let breakerTripped = false;
    let action = 'continue';

    if (budget.spent >= budget.budget) {
      breakerTripped = true;
      action = 'halt_rollback';
      budget.status = 'tripped';

      const breaker = {
        id: `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`,
        taskId,
        budget: budget.budget,
        spent: budget.spent,
        breakdown: { ...budget.breakdown },
        evidenceRef,
        trippedAt: new Date().toISOString(),
        action,
        claim: `🚨 Circuit breaker tripped: task ${taskId} spent $${budget.spent.toFixed(4)} >= budget $${budget.budget.toFixed(4)} — ${action}`
      };

      this.breakers.push(breaker);

      return {
        taskId,
        type,
        amount,
        tokens,
        spent: budget.spent,
        budget: budget.budget,
        remaining,
        percentUsed: percentUsed + '%',
        breakerTripped,
        breaker,
        action,
        claim: breaker.claim
      };
    } else if (budget.spent >= budget.budget * 0.8) {
      action = 'warn_throttle';
      budget.status = 'warning';
    }

    return {
      taskId,
      type,
      amount,
      tokens,
      spent: budget.spent.toFixed(4),
      budget: budget.budget.toFixed(4),
      remaining: remaining.toFixed(4),
      percentUsed: percentUsed + '%',
      breakerTripped,
      action,
      breakdown: budget.breakdown,
      claim: `Cost recorded: $${amount.toFixed(4)} ${type} — task ${taskId} $${budget.spent.toFixed(4)}/$${budget.budget.toFixed(4)} (${percentUsed}%) — ${action}`
    };
  }

  checkBudget(taskId) {
    const budget = this.budgets.get(taskId);
    if (!budget) return { exists: false, taskId };

    return {
      exists: true,
      taskId,
      budget: budget.budget,
      spent: budget.spent,
      remaining: budget.budget - budget.spent,
      percentUsed: (budget.spent / budget.budget * 100).toFixed(1) + '%',
      status: budget.status,
      breakdown: budget.breakdown,
      tripped: budget.status === 'tripped'
    };
  }

  getStats() {
    const totalTasks = this.budgets.size;
    const tripped = [...this.budgets.values()].filter(b => b.status === 'tripped').length;
    const warning = [...this.budgets.values()].filter(b => b.status === 'warning').length;

    return {
      totalTasks,
      tripped,
      warning,
      totalSpent: this.totalSpent.toFixed(4),
      totalBreakers: this.breakers.length,
      avgSpentPerTask: totalTasks > 0 ? (this.totalSpent / totalTasks).toFixed(4) : '0',
      claim: 'Cost circuit breaker — budget enforcement per task, halt+rollback on exceed, evidence-bound ledger'
    };
  }
}
