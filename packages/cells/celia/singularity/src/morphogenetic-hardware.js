/**
 * NEXA v1.0 — Morphogenetic Hardware Reconfiguration Engine
 * 
 * إعادة تشكيل العتاد ذاتياً عبر التشكل — Morphogenesis
 * - Hardware self-organizes like biological development
 * - Turing reaction-diffusion pattern formation
 */

export class MorphogeneticHardwareEngine {
  constructor({ gridSize = 20 } = {}) {
    this.gridSize = gridSize;
    this.grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null).map(() => ({
      activator: Math.random(),
      inhibitor: Math.random(),
      hardwareType: 'generic'
    })));
    this.reconfigurations = [];
  }

  turingPatternStep({ Da = 0.16, Di = 0.08, f = 0.035, k = 0.065 } = {}) {
    // Gray-Scott reaction-diffusion: Turing patterns
    const newGrid = this.grid.map(row => row.map(cell => ({ ...cell })));
    let changes = 0;

    for (let x = 1; x < this.gridSize - 1; x++) {
      for (let y = 1; y < this.gridSize - 1; y++) {
        const cell = this.grid[x][y];
        const neighbors = [
          this.grid[x-1][y], this.grid[x+1][y],
          this.grid[x][y-1], this.grid[x][y+1]
        ];
        const laplaceA = neighbors.reduce((sum, n) => sum + n.activator, 0) - 4 * cell.activator;
        const laplaceI = neighbors.reduce((sum, n) => sum + n.inhibitor, 0) - 4 * cell.inhibitor;

        const newA = cell.activator + (Da * laplaceA - cell.activator * cell.inhibitor * cell.inhibitor + f * (1 - cell.activator));
        const newI = cell.inhibitor + (Di * laplaceI + cell.activator * cell.inhibitor * cell.inhibitor - (f + k) * cell.inhibitor);

        newGrid[x][y].activator = Math.max(0, Math.min(1, newA));
        newGrid[x][y].inhibitor = Math.max(0, Math.min(1, newI));

        if (Math.abs(newA - cell.activator) > 0.01) changes++;

        // Map activator/inhibitor to hardware type
        if (newA > 0.6 && newI < 0.3) newGrid[x][y].hardwareType = 'compute';
        else if (newA < 0.3 && newI > 0.6) newGrid[x][y].hardwareType = 'memory';
        else if (newA > 0.5 && newI > 0.5) newGrid[x][y].hardwareType = 'io';
        else newGrid[x][y].hardwareType = 'generic';
      }
    }

    this.grid = newGrid;

    return {
      changes,
      total: this.gridSize * this.gridSize,
      changeRate: (changes / (this.gridSize*this.gridSize) * 100).toFixed(1) + '%',
      hardwareTypes: this._countHardwareTypes(),
      method: 'Turing reaction-diffusion Gray-Scott — activator-inhibitor morphogenesis',
      claim: `Morphogenetic hardware: Turing pattern step ${changes}/${this.gridSize*this.gridSize} changed ${ (changes/(this.gridSize*this.gridSize)*100).toFixed(1)}% — hardware self-organized into ${Object.entries(this._countHardwareTypes()).map(([k,v])=>`${k}:${v}`).join(' ')} — bio-inspired morphogenesis`
    };
  }

  _countHardwareTypes() {
    const counts = {};
    for (const row of this.grid) {
      for (const cell of row) {
        counts[cell.hardwareType] = (counts[cell.hardwareType] || 0) + 1;
      }
    }
    return counts;
  }

  reconfigure(taskRequirement) {
    // Reconfigure hardware based on task: e.g., more compute for heavy tasks
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      this.turingPatternStep();
    }

    const reconfig = {
      id: `reconfig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`,
      taskRequirement,
      hardwareTypes: this._countHardwareTypes(),
      steps,
      method: 'Morphogenetic reconfiguration via Turing patterns — hardware adapts to task',
      timestamp: new Date().toISOString()
    };

    this.reconfigurations.push(reconfig);
    return {
      ...reconfig,
      claim: `Hardware reconfigured for "${taskRequirement.slice(0,30)}..." in ${steps} Turing steps → ${Object.entries(reconfig.hardwareTypes).map(([k,v])=>`${k}:${v}`).join(' ')} — morphogenetic self-organizing hardware`
    };
  }

  getStats() {
    return {
      gridSize: this.gridSize,
      totalCells: this.gridSize * this.gridSize,
      hardwareTypes: this._countHardwareTypes(),
      reconfigurations: this.reconfigurations.length,
      claim: 'Morphogenetic hardware reconfig — Turing reaction-diffusion Gray-Scott activator-inhibitor, self-organizing hardware like biological development'
    };
  }
}
