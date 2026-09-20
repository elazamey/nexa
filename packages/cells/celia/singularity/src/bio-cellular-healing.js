/**
 * NEXA v1.0 — Bio-Cellular Self-Healing Engine
 * 
 * شفاء ذاتي مستوحى من الخلايا البيولوجية — Cellular Automata
 * - Each cell checks neighbors, heals via local rules, no central control
 */

export class BioCellularHealingEngine {
  constructor({ gridSize = 10 } = {}) {
    this.gridSize = gridSize;
    this.grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null).map(() => ({
      healthy: true,
      health: 1.0,
      neighbors: 0,
      healed: 0
    })));
    this.healingEvents = [];
  }

  injure(x, y, { severity = 0.5 } = {}) {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) throw new Error('Out of bounds');
    const cell = this.grid[x][y];
    cell.healthy = false;
    cell.health = Math.max(0, 1.0 - severity);
    cell.injuredAt = Date.now();
    return cell;
  }

  healStep() {
    let healed = 0;
    const newGrid = this.grid.map(row => row.map(cell => ({ ...cell })));

    for (let x = 0; x < this.gridSize; x++) {
      for (let y = 0; y < this.gridSize; y++) {
        const cell = this.grid[x][y];
        if (!cell.healthy) {
          // Count healthy neighbors — cellular automata rule
          let healthyNeighbors = 0;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
                if (this.grid[nx][ny].healthy) healthyNeighbors++;
              }
            }
          }

          // If >=3 healthy neighbors, heal
          if (healthyNeighbors >= 3) {
            newGrid[x][y].healthy = true;
            newGrid[x][y].health = Math.min(1.0, cell.health + 0.3);
            newGrid[x][y].healed++;
            healed++;
            this.healingEvents.push({ x, y, healthyNeighbors, healedAt: Date.now() });
          }
        }
      }
    }

    this.grid = newGrid;
    return {
      healed,
      total: this.gridSize * this.gridSize,
      healthy: this.grid.flat().filter(c => c.healthy).length,
      healingRate: (healed / (this.gridSize*this.gridSize) * 100).toFixed(1) + '% this step',
      method: 'Cellular automata — local neighbor rules, no central control, bio-inspired',
      claim: `Bio-cellular healing: ${healed} cells healed via neighbor rule >=3 healthy neighbors — ${this.grid.flat().filter(c=>c.healthy).length}/${this.gridSize*this.gridSize} healthy — decentralized`
    };
  }

  getStats() {
    const total = this.gridSize * this.gridSize;
    const healthy = this.grid.flat().filter(c => c.healthy).length;
    const injured = total - healthy;
    return {
      gridSize: this.gridSize,
      total,
      healthy,
      injured,
      healthRate: (healthy / total * 100).toFixed(1) + '%',
      healingEvents: this.healingEvents.length,
      claim: 'Bio-cellular self-healing — cellular automata local rules, no central control, neighbor-based healing'
    };
  }
}
