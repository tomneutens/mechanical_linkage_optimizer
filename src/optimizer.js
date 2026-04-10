/**
 * Linkage Optimizer — Differential Evolution optimizer that finds
 * linkage parameters to best match a target curve.
 *
 * Uses a fitness function based on Fréchet-like distance between
 * the traced output and the target curve.
 */

import { createFourBar, createSixBar, createEightBar } from './linkage.js';

export class Optimizer {
  constructor() {
    this.running = false;
    this.bestLinkage = null;
    this.bestError = Infinity;
    this.onProgress = null; // callback(progress, bestError)
    this._cancel = false;
  }

  cancel() {
    this._cancel = true;
  }

  /**
   * Run optimization.
   * @param {Array<{x,y}>} targetPoints - sampled points from target curve
   * @param {number} barCount - 4, 6, or 8
   * @param {number} numCranks - 1 or 2
   * @param {number} iterations - total iterations
   * @param {Array<{vertices:Array<{x,y}>}>} exclusionZones - polygonal zones to avoid
   * @returns {Promise<{linkage, error}>}
   */
  async optimize(targetPoints, barCount, numCranks, iterations, exclusionZones = []) {
    this.running = true;
    this._cancel = false;
    this.bestError = Infinity;
    this.bestLinkage = null;

    // Compute target bounding box for parameter range estimation
    const bounds = this._computeBounds(targetPoints);
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const margin = size * 0.5;

    // Define parameter ranges based on bar count
    const paramDef = this._getParamDef(barCount, center, size, margin, numCranks);
    const dim = paramDef.length;

    // Differential Evolution
    const popSize = Math.max(40, dim * 8);
    const F = 0.7;   // mutation factor
    const CR = 0.85;  // crossover rate

    // Initialize population
    let population = [];
    for (let i = 0; i < popSize; i++) {
      const individual = paramDef.map(p => p.min + Math.random() * (p.max - p.min));
      population.push(individual);
    }

    let fitness = population.map(ind =>
      this._evaluate(ind, barCount, numCranks, targetPoints, exclusionZones)
    );

    // Find initial best
    for (let i = 0; i < popSize; i++) {
      if (fitness[i] < this.bestError) {
        this.bestError = fitness[i];
        this.bestLinkage = this._buildLinkage(population[i], barCount, numCranks);
      }
    }

    const batchSize = 50;
    for (let gen = 0; gen < iterations; gen++) {
      if (this._cancel) break;

      for (let i = 0; i < popSize; i++) {
        // Pick 3 distinct random individuals (not i)
        let r1, r2, r3;
        do { r1 = Math.floor(Math.random() * popSize); } while (r1 === i);
        do { r2 = Math.floor(Math.random() * popSize); } while (r2 === i || r2 === r1);
        do { r3 = Math.floor(Math.random() * popSize); } while (r3 === i || r3 === r1 || r3 === r2);

        // Mutation + Crossover
        const jRand = Math.floor(Math.random() * dim);
        const trial = population[i].map((val, j) => {
          if (j === jRand || Math.random() < CR) {
            let v = population[r1][j] + F * (population[r2][j] - population[r3][j]);
            // Clamp to bounds
            v = Math.max(paramDef[j].min, Math.min(paramDef[j].max, v));
            return v;
          }
          return val;
        });

        const trialFitness = this._evaluate(trial, barCount, numCranks, targetPoints, exclusionZones);

        if (trialFitness <= fitness[i]) {
          population[i] = trial;
          fitness[i] = trialFitness;

          if (trialFitness < this.bestError) {
            this.bestError = trialFitness;
            this.bestLinkage = this._buildLinkage(trial, barCount, numCranks);
          }
        }
      }

      // Yield to UI every batchSize generations
      if (gen % batchSize === 0) {
        if (this.onProgress) {
          this.onProgress(gen / iterations, this.bestError);
        }
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.running = false;
    if (this.onProgress) {
      this.onProgress(1, this.bestError);
    }

    return { linkage: this.bestLinkage, error: this.bestError };
  }

  /**
   * Auto-optimize: try simple first, increase complexity if error is too high.
   */
  async autoOptimize(targetPoints, numCranks, iterations, exclusionZones = [], errorThreshold = 15) {
    // Try 4-bar first
    const result4 = await this.optimize(targetPoints, 4, numCranks, Math.floor(iterations * 0.5), exclusionZones);
    if (this._cancel) return result4;
    if (result4.error < errorThreshold) return result4;

    // Try 6-bar
    const result6 = await this.optimize(targetPoints, 6, numCranks, Math.floor(iterations * 0.7), exclusionZones);
    if (this._cancel) return result6;
    if (result6.error < errorThreshold) return { ...result6, upgraded: true };

    // Try 8-bar
    const result8 = await this.optimize(targetPoints, 8, numCranks, iterations, exclusionZones);
    return { ...result8, upgraded: true };
  }

  _computeBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  _getParamDef(barCount, center, size, margin, numCranks) {
    const lo = (v, range) => v - range;
    const hi = (v, range) => v + range;
    const R = size * 0.8;
    const minL = size * 0.05;
    const maxL = size * 1.2;

    const base = [
      { name: 'ground0x', min: center.x - R, max: center.x + R },
      { name: 'ground0y', min: center.y - R, max: center.y + R },
      { name: 'ground1x', min: center.x - R, max: center.x + R },
      { name: 'ground1y', min: center.y - R, max: center.y + R },
      { name: 'crankLength', min: minL, max: maxL },
      { name: 'couplerLength', min: minL, max: maxL },
      { name: 'followerLength', min: minL, max: maxL },
      { name: 'couplerPointAngle', min: -Math.PI, max: Math.PI },
      { name: 'couplerPointDist', min: -maxL, max: maxL },
      { name: 'phaseOffset', min: 0, max: 2 * Math.PI },
    ];

    if (barCount === 4) return base;

    const ext6 = [
      ...base,
      { name: 'ground2x', min: center.x - R, max: center.x + R },
      { name: 'ground2y', min: center.y - R, max: center.y + R },
      { name: 'crank2Length', min: minL, max: maxL },
      { name: 'coupler2Length', min: minL, max: maxL },
      { name: 'follower2Length', min: minL, max: maxL },
      { name: 'phaseOffset2', min: 0, max: 2 * Math.PI },
    ];

    if (barCount === 6) return ext6;

    // 8-bar
    return [
      ...ext6,
      { name: 'ground3x', min: center.x - R, max: center.x + R },
      { name: 'ground3y', min: center.y - R, max: center.y + R },
      { name: 'link3aLength', min: minL, max: maxL },
      { name: 'link3bLength', min: minL, max: maxL },
      { name: 'link3cLength', min: minL, max: maxL },
    ];
  }

  _buildLinkage(params, barCount, numCranks) {
    if (barCount === 4) {
      return createFourBar({
        ground0x: params[0], ground0y: params[1],
        ground1x: params[2], ground1y: params[3],
        crankLength: params[4],
        couplerLength: params[5],
        followerLength: params[6],
        couplerPointAngle: params[7],
        couplerPointDist: params[8],
        phaseOffset: params[9],
      });
    }

    if (barCount === 6) {
      return createSixBar({
        ground0x: params[0], ground0y: params[1],
        ground1x: params[2], ground1y: params[3],
        crank1Length: params[4],
        coupler1Length: params[5],
        follower1Length: params[6],
        couplerPointAngle: params[7],
        couplerPointDist: params[8],
        phaseOffset1: params[9],
        ground2x: params[10], ground2y: params[11],
        crank2Length: params[12],
        coupler2Length: params[13],
        follower2Length: params[14],
        phaseOffset2: params[15],
        numCranks,
      });
    }

    // 8-bar
    return createEightBar({
      ground0x: params[0], ground0y: params[1],
      ground1x: params[2], ground1y: params[3],
      crank1Length: params[4],
      coupler1Length: params[5],
      follower1Length: params[6],
      couplerPointAngle: params[7],
      couplerPointDist: params[8],
      phaseOffset1: params[9],
      ground2x: params[10], ground2y: params[11],
      link2aLength: params[12],
      link2bLength: params[13],
      link2cLength: params[14],
      ground3x: params[16] ?? params[10] + 50,
      ground3y: params[17] ?? params[11],
      link3aLength: params[18] ?? params[12],
      link3bLength: params[19] ?? params[13],
      link3cLength: params[20] ?? params[14],
      numCranks,
    });
  }

  _evaluate(params, barCount, numCranks, targetPoints, exclusionZones) {
    const linkage = this._buildLinkage(params, barCount, numCranks);
    if (!linkage) return 1e9;

    const trace = linkage.traceOutput(targetPoints.length);
    if (trace.length === 0) return 1e9;

    // Compute curve fitting error
    let error = curveError(targetPoints, trace);

    // Add exclusion zone penalty: check joint/link positions through full rotation
    if (exclusionZones.length > 0) {
      error += this._zoneViolationPenalty(linkage, exclusionZones, targetPoints.length);
    }

    return error;
  }

  /**
   * Compute a penalty for linkage components passing through exclusion zones.
   * Samples the linkage at multiple angles and checks whether ANY joint position
   * or link segment midpoint falls inside an exclusion zone polygon.
   */
  _zoneViolationPenalty(linkage, zones, steps) {
    const checkSteps = Math.min(steps, 64); // check at fewer steps for performance
    let violationCount = 0;

    for (let i = 0; i < checkSteps; i++) {
      const angle = (2 * Math.PI * i) / checkSteps;
      const angles = linkage.cranks.map((_, ci) => ci === 0 ? angle : angle * (ci + 1));
      const positions = linkage.solve(angles);
      if (!positions) continue;

      // Check every joint position
      for (const pos of positions) {
        if (!pos) continue;
        for (const zone of zones) {
          if (pointInPolygon(pos, zone.vertices)) {
            violationCount++;
          }
        }
      }

      // Check midpoints of every link (catches links passing through zones)
      for (const link of linkage.links) {
        const p1 = positions[link.from];
        const p2 = positions[link.to];
        if (!p1 || !p2) continue;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        for (const zone of zones) {
          if (pointInPolygon(mid, zone.vertices)) {
            violationCount++;
          }
        }
        // Also check quarter-points for long links
        const q1 = { x: p1.x * 0.75 + p2.x * 0.25, y: p1.y * 0.75 + p2.y * 0.25 };
        const q3 = { x: p1.x * 0.25 + p2.x * 0.75, y: p1.y * 0.25 + p2.y * 0.75 };
        for (const zone of zones) {
          if (pointInPolygon(q1, zone.vertices)) violationCount++;
          if (pointInPolygon(q3, zone.vertices)) violationCount++;
        }
      }
    }

    // Heavy penalty proportional to violations
    return violationCount * 50;
  }
}

/**
 * Bidirectional average closest-point distance between two curves.
 * Also accounts for proportional shape matching by normalizing.
 */
function curveError(target, trace) {
  if (trace.length === 0) return 1e9;

  // Forward: for each target point, find closest trace point
  let sumForward = 0;
  for (const tp of target) {
    let minD = Infinity;
    for (const op of trace) {
      const d = Math.hypot(tp.x - op.x, tp.y - op.y);
      if (d < minD) minD = d;
    }
    sumForward += minD;
  }

  // Backward: for each trace point, find closest target point
  let sumBackward = 0;
  for (const op of trace) {
    let minD = Infinity;
    for (const tp of target) {
      const d = Math.hypot(tp.x - op.x, tp.y - op.y);
      if (d < minD) minD = d;
    }
    sumBackward += minD;
  }

  const n = Math.max(target.length, trace.length);
  return (sumForward + sumBackward) / (2 * n);
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if point p is inside the polygon defined by vertices.
 */
function pointInPolygon(p, vertices) {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = vertices[i];
    const vj = vertices[j];
    if (
      ((vi.y > p.y) !== (vj.y > p.y)) &&
      (p.x < (vj.x - vi.x) * (p.y - vi.y) / (vj.y - vi.y) + vi.x)
    ) {
      inside = !inside;
    }
  }
  return inside;
}
