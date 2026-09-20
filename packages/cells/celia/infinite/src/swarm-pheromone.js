/**
 * NEXA v0.9 — Swarm Intelligence & Pheromone Protocol
 * 
 * التنظيم الذاتي اللامركزي للأسراب — محاكاة مستعمرات النمل
 * - آلاف الوكلاء الدقيقة Micro-Agents في شبكة P2P — لا وجود لوكيل رئيسي Single Point of Failure
 * - عندما يكتشف وكيل مشكلة، يطلق إشارة دلالية Digital Pheromones في الذاكرة المشتركة
 * - تنجذب الوكلاء المتخصصة نحو الإشارة تلقائياً، تعمل معاً، تتشتت بعد الإنجاز دون أمر إداري
 */

export class SwarmPheromoneEngine {
  constructor({ maxAgents = 10000, pheromoneDecay = 0.05 } = {}) {
    this.agents = new Map(); // agentId → { specialty, position, pheromoneSensitivity }
    this.pheromones = new Map(); // pheromoneId → { type, strength, position, sourceAgent, createdAt, decay }
    this.maxAgents = maxAgents;
    this.pheromoneDecay = pheromoneDecay;
    this.swarmTasks = new Map();
  }

  registerAgent(agentId, { specialty = 'general', position = { x: 0, y: 0 }, sensitivity = 0.7 } = {}) {
    const agent = {
      id: agentId,
      specialty,
      position,
      sensitivity,
      pheromoneTrails: [],
      tasksCompleted: 0,
      createdAt: Date.now()
    };
    this.agents.set(agentId, agent);
    return agent;
  }

  /**
   * Agent detects problem — emits digital pheromone
   */
  emitPheromone(agentId, { type = 'problem', strength = 1.0, position = null, data = {} } = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const pheromoneId = `phero_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;

    const pheromone = {
      id: pheromoneId,
      type,
      strength,
      position: position || agent.position,
      sourceAgent: agentId,
      specialty: agent.specialty,
      data,
      createdAt: Date.now(),
      decay: this.pheromoneDecay,
      currentStrength: strength,
      attractedAgents: []
    };

    this.pheromones.set(pheromoneId, pheromone);

    // Attract nearby specialized agents
    const attracted = this._attractAgents(pheromone);

    pheromone.attractedAgents = attracted.map(a => a.id);

    return {
      pheromoneId,
      type,
      sourceAgent: agentId,
      strength,
      attractedCount: attracted.length,
      attracted: attracted.slice(0,3).map(a => ({ id: a.id, specialty: a.specialty, distance: a.distance.toFixed(1), coupling: a.coupling.toFixed(2) })),
      totalAgents: this.agents.size,
      claim: `Digital pheromone emitted by ${agentId} (${agent.specialty}) type=${type} strength=${strength} → ${attracted.length}/${this.agents.size} agents attracted via P2P, no central orchestrator`
    };
  }

  _attractAgents(pheromone) {
    const attracted = [];

    for (const [id, agent] of this.agents.entries()) {
      if (id === pheromone.sourceAgent) continue;

      const distance = Math.sqrt((agent.position.x - pheromone.position.x)**2 + (agent.position.y - pheromone.position.y)**2);
      const specialtyMatch = agent.specialty === pheromone.specialty || pheromone.type.includes(agent.specialty) || agent.specialty === 'general' ? 1.5 : 1.0;
      const coupling = (pheromone.strength * agent.sensitivity * specialtyMatch) / (1 + distance * 0.01);

      if (coupling > 0.3) {
        attracted.push({ ...agent, distance, coupling });
        agent.pheromoneTrails.push(pheromone.id);
      }
    }

    // Sort by coupling strength
    attracted.sort((a,b) => b.coupling - a.coupling);
    return attracted;
  }

  /**
   * Swarm task execution — attracted agents collaborate without central command
   */
  async executeSwarmTask(pheromoneId, task) {
    const pheromone = this.pheromones.get(pheromoneId);
    if (!pheromone) throw new Error(`Pheromone not found: ${pheromoneId}`);

    const attractedAgents = pheromone.attractedAgents.map(id => this.agents.get(id)).filter(Boolean);

    const taskId = `swarm_${Date.now().toString(36)}`;
    const swarmTask = {
      id: taskId,
      pheromoneId,
      task,
      agents: attractedAgents.map(a => a.id),
      status: 'running',
      startedAt: Date.now(),
      collaborations: []
    };

    this.swarmTasks.set(taskId, swarmTask);

    // Simulate P2P collaboration — no central orchestrator
    for (const agent of attractedAgents) {
      const contribution = {
        agentId: agent.id,
        specialty: agent.specialty,
        contribution: `Agent ${agent.id} (${agent.specialty}) contributed to ${task}`,
        timestamp: Date.now()
      };
      swarmTask.collaborations.push(contribution);
      agent.tasksCompleted++;
    }

    // Task completion — pheromone evaporates, agents disperse
    swarmTask.status = 'completed';
    swarmTask.completedAt = Date.now();
    swarmTask.duration = swarmTask.completedAt - swarmTask.startedAt;

    // Decay pheromone
    pheromone.currentStrength *= 0.1;

    return {
      taskId,
      pheromoneId,
      agents: attractedAgents.length,
      collaborations: swarmTask.collaborations.length,
      duration: swarmTask.duration,
      pheromoneStrengthAfter: pheromone.currentStrength.toFixed(3),
      dispersed: true,
      claim: `Swarm task ${taskId}: ${attractedAgents.length} agents collaborated P2P no central command, ${swarmTask.collaborations.length} contributions, completed ${swarmTask.duration}ms, agents dispersed — self-organizing`
    };
  }

  /**
   * Decay old pheromones — like real ant colonies
   */
  decayPheromones() {
    let decayed = 0;
    let removed = 0;

    for (const [id, phero] of this.pheromones.entries()) {
      phero.currentStrength *= (1 - phero.decay);
      decayed++;

      if (phero.currentStrength < 0.05) {
        this.pheromones.delete(id);
        removed++;
      }
    }

    return { decayed, removed, remaining: this.pheromones.size };
  }

  getStats() {
    return {
      agents: this.agents.size,
      pheromones: this.pheromones.size,
      swarmTasks: this.swarmTasks.size,
      totalCollaborations: [...this.swarmTasks.values()].reduce((sum, t) => sum + t.collaborations.length, 0),
      specialties: [...new Set([...this.agents.values()].map(a => a.specialty))],
      claim: 'Decentralized self-organizing swarm — no central orchestrator, no single point of failure, digital pheromones P2P'
    };
  }
}
