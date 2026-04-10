/**
 * Linkage data model and forward kinematics.
 *
 * Supports N-bar planar linkages with rotational crank inputs.
 * A linkage is defined by:
 *   - groundPins: array of fixed pivot positions {x, y}
 *   - links: array of { from, to, length } connecting joint indices
 *   - joints: array of joint info { type: 'ground'|'revolute'|'crank'|'output', x, y }
 *   - cranks: array of { jointIndex, groundIndex, radius, phaseOffset }
 *   - outputJointIndex: which joint traces the output curve
 */

export class Linkage {
  constructor(config) {
    this.joints = config.joints.map(j => ({ ...j }));
    this.links = config.links.map(l => ({ ...l }));
    this.cranks = config.cranks.map(c => ({ ...c }));
    this.outputJointIndex = config.outputJointIndex;
  }

  /** Solve the linkage position for a given crank angle (radians).
   *  Returns the joint positions array, or null if the configuration is impossible. */
  solve(angles) {
    const positions = this.joints.map(j => ({ x: j.x, y: j.y }));

    // Set crank positions
    for (let i = 0; i < this.cranks.length; i++) {
      const crank = this.cranks[i];
      const angle = (angles[i] || 0) + crank.phaseOffset;
      const ground = positions[crank.groundIndex];
      positions[crank.jointIndex] = {
        x: ground.x + crank.radius * Math.cos(angle),
        y: ground.y + crank.radius * Math.sin(angle),
      };
    }

    // Iteratively solve remaining joints using distance constraints
    const solved = new Set();
    // Ground joints and crank-driven joints are solved
    for (const j of this.joints) {
      if (j.type === 'ground') solved.add(this.joints.indexOf(j));
    }
    for (const c of this.cranks) {
      solved.add(c.groundIndex);
      solved.add(c.jointIndex);
    }

    let maxIter = 20;
    let changed = true;
    while (changed && maxIter-- > 0) {
      changed = false;
      for (const link of this.links) {
        const aSolved = solved.has(link.from);
        const bSolved = solved.has(link.to);

        if (aSolved && bSolved) continue;
        if (!aSolved && !bSolved) continue;

        if (aSolved && !bSolved) {
          // Find another link connected to link.to that is also solved
          const otherLink = this.links.find(l =>
            l !== link &&
            (l.from === link.to || l.to === link.to) &&
            solved.has(l.from === link.to ? l.to : l.from)
          );
          if (otherLink) {
            const otherEnd = otherLink.from === link.to ? otherLink.to : otherLink.from;
            const result = circleIntersection(
              positions[link.from], link.length,
              positions[otherEnd], otherLink.length,
              positions[link.to] // use current position as hint
            );
            if (result) {
              positions[link.to] = result;
              solved.add(link.to);
              changed = true;
            }
          }
        } else if (bSolved && !aSolved) {
          const otherLink = this.links.find(l =>
            l !== link &&
            (l.from === link.from || l.to === link.from) &&
            solved.has(l.from === link.from ? l.to : l.from)
          );
          if (otherLink) {
            const otherEnd = otherLink.from === link.from ? otherLink.to : otherLink.from;
            const result = circleIntersection(
              positions[link.to], link.length,
              positions[otherEnd], otherLink.length,
              positions[link.from]
            );
            if (result) {
              positions[link.from] = result;
              solved.add(link.from);
              changed = true;
            }
          }
        }
      }
    }

    // Check all joints are solved (skip 'output' joints — they are
    // computed by the factory-function override of solve())
    for (let i = 0; i < this.joints.length; i++) {
      if (!solved.has(i) && this.joints[i].type !== 'output') return null;
    }

    return positions;
  }

  /** Trace the output point through a full rotation.
   *  Returns array of {x, y} or empty if linkage jams. */
  traceOutput(steps = 128) {
    const points = [];
    for (let i = 0; i < steps; i++) {
      const angle = (2 * Math.PI * i) / steps;
      const angles = this.cranks.map((_, ci) => ci === 0 ? angle : angle * (ci + 1));
      const positions = this.solve(angles);
      if (!positions) return []; // linkage jams
      points.push({ ...positions[this.outputJointIndex] });
    }
    return points;
  }

  getOutputPosition(angles) {
    const positions = this.solve(angles);
    if (!positions) return null;
    return positions[this.outputJointIndex];
  }
}

/**
 * Find the intersection of two circles that is closest to `hint`.
 * Circle 1: center c1, radius r1
 * Circle 2: center c2, radius r2
 */
function circleIntersection(c1, r1, c2, r2, hint) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);

  if (d > r1 + r2 + 0.01 || d < Math.abs(r1 - r2) - 0.01 || d < 1e-10) {
    return null;
  }

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;

  const mx = c1.x + a * dx / d;
  const my = c1.y + a * dy / d;

  const p1 = { x: mx + h * dy / d, y: my - h * dx / d };
  const p2 = { x: mx - h * dy / d, y: my + h * dx / d };

  if (!hint) return p1;

  const d1 = Math.hypot(p1.x - hint.x, p1.y - hint.y);
  const d2 = Math.hypot(p2.x - hint.x, p2.y - hint.y);
  return d1 <= d2 ? p1 : p2;
}

/**
 * Create a 4-bar linkage from parameters.
 * ground0, ground1: positions of the two ground pivots
 * crankLength: length of the input crank
 * couplerLength: length of the coupler link
 * followerLength: length of the follower (rocker) link
 * outputRatio: where on the coupler to place the output (0-1, or extended)
 * couplerPointAngle: angle offset for the coupler output point
 * couplerPointDist: distance from coupler line for the output point
 */
export function createFourBar(params) {
  const {
    ground0x, ground0y, ground1x, ground1y,
    crankLength, couplerLength, followerLength,
    couplerPointAngle, couplerPointDist,
    phaseOffset,
  } = params;

  // Joints: 0=ground0, 1=ground1, 2=crankEnd, 3=followerEnd, 4=couplerPoint(output)
  const joints = [
    { type: 'ground', x: ground0x, y: ground0y },
    { type: 'ground', x: ground1x, y: ground1y },
    { type: 'crank', x: ground0x + crankLength, y: ground0y },
    { type: 'revolute', x: ground1x, y: ground1y - followerLength },
    { type: 'output', x: ground0x + crankLength, y: ground0y }, // placeholder
  ];

  const links = [
    { from: 0, to: 2, length: crankLength },
    { from: 2, to: 3, length: couplerLength },
    { from: 1, to: 3, length: followerLength },
  ];

  const cranks = [
    { jointIndex: 2, groundIndex: 0, radius: crankLength, phaseOffset: phaseOffset || 0 },
  ];

  const linkage = new Linkage({
    joints, links, cranks, outputJointIndex: 4,
  });

  // Override solve to position the coupler point
  const originalSolve = linkage.solve.bind(linkage);
  linkage.solve = function (angles) {
    const positions = originalSolve(angles);
    if (!positions) return null;

    const p2 = positions[2];
    const p3 = positions[3];
    const midX = (p2.x + p3.x) / 2;
    const midY = (p2.y + p3.y) / 2;
    const linkAngle = Math.atan2(p3.y - p2.y, p3.x - p2.x);
    const outAngle = linkAngle + (couplerPointAngle || 0);

    positions[4] = {
      x: midX + (couplerPointDist || 0) * Math.cos(outAngle),
      y: midY + (couplerPointDist || 0) * Math.sin(outAngle),
    };

    return positions;
  };

  return linkage;
}

/**
 * Create a 6-bar Watt I linkage from parameters.
 * This stacks a second 4-bar on top of the first, giving more complex paths.
 */
export function createSixBar(params) {
  const {
    ground0x, ground0y, ground1x, ground1y, ground2x, ground2y,
    crank1Length, coupler1Length, follower1Length,
    crank2Length, coupler2Length, follower2Length,
    couplerPointAngle, couplerPointDist,
    phaseOffset1, phaseOffset2,
    numCranks,
  } = params;

  // Joints: 0=g0, 1=g1, 2=crank1end, 3=mid, 4=g2, 5=crank2end/joint, 6=end, 7=output
  const joints = [
    { type: 'ground', x: ground0x, y: ground0y },       // 0
    { type: 'ground', x: ground1x, y: ground1y },       // 1
    { type: 'crank', x: ground0x + crank1Length, y: ground0y }, // 2
    { type: 'revolute', x: ground1x, y: ground1y - follower1Length }, // 3
    { type: 'ground', x: ground2x, y: ground2y },       // 4
    { type: 'revolute', x: ground2x, y: ground2y - crank2Length }, // 5 (or second crank)
    { type: 'revolute', x: ground2x + 50, y: ground2y }, // 6
    { type: 'output', x: ground2x, y: ground2y },       // 7
  ];

  const links = [
    { from: 0, to: 2, length: crank1Length },
    { from: 2, to: 3, length: coupler1Length },
    { from: 1, to: 3, length: follower1Length },
    // Second stage connects from joint 3 to joint 6 via joint 5
    { from: 3, to: 5, length: crank2Length },
    { from: 5, to: 6, length: coupler2Length },
    { from: 4, to: 6, length: follower2Length },
  ];

  const cranks = [
    { jointIndex: 2, groundIndex: 0, radius: crank1Length, phaseOffset: phaseOffset1 || 0 },
  ];

  if (numCranks >= 2) {
    joints[5].type = 'crank';
    cranks.push({ jointIndex: 5, groundIndex: 4, radius: crank2Length, phaseOffset: phaseOffset2 || 0 });
    // Remove the link from 3->5 since 5 is now crank-driven
    const idx = links.findIndex(l => l.from === 3 && l.to === 5);
    if (idx >= 0) links.splice(idx, 1);
  }

  const linkage = new Linkage({
    joints, links, cranks, outputJointIndex: 7,
  });

  const originalSolve = linkage.solve.bind(linkage);
  linkage.solve = function (angles) {
    const positions = originalSolve(angles);
    if (!positions) return null;

    const p5 = positions[5];
    const p6 = positions[6];
    const midX = (p5.x + p6.x) / 2;
    const midY = (p5.y + p6.y) / 2;
    const linkAngle = Math.atan2(p6.y - p5.y, p6.x - p5.x);
    const outAngle = linkAngle + (couplerPointAngle || 0);

    positions[7] = {
      x: midX + (couplerPointDist || 0) * Math.cos(outAngle),
      y: midY + (couplerPointDist || 0) * Math.sin(outAngle),
    };

    return positions;
  };

  return linkage;
}

/**
 * Create an 8-bar linkage (Watt chain extension).
 */
export function createEightBar(params) {
  const {
    ground0x, ground0y, ground1x, ground1y,
    ground2x, ground2y, ground3x, ground3y,
    crank1Length, coupler1Length, follower1Length,
    link2aLength, link2bLength, link2cLength,
    link3aLength, link3bLength, link3cLength,
    couplerPointAngle, couplerPointDist,
    phaseOffset1,
    numCranks,
  } = params;

  // 0=g0, 1=g1, 2=crank1end, 3=mid1
  // 4=g2, 5=j5, 6=j6
  // 7=g3, 8=j8, 9=j9
  // 10=output
  const joints = [
    { type: 'ground', x: ground0x, y: ground0y },
    { type: 'ground', x: ground1x, y: ground1y },
    { type: 'crank', x: ground0x + crank1Length, y: ground0y },
    { type: 'revolute', x: ground1x, y: ground1y - follower1Length },
    { type: 'ground', x: ground2x, y: ground2y },
    { type: 'revolute', x: ground2x + link2aLength, y: ground2y },
    { type: 'revolute', x: ground2x + link2aLength + link2bLength, y: ground2y },
    { type: 'ground', x: ground3x, y: ground3y },
    { type: 'revolute', x: ground3x + link3aLength, y: ground3y },
    { type: 'revolute', x: ground3x + link3aLength + link3bLength, y: ground3y },
    { type: 'output', x: ground3x, y: ground3y },
  ];

  const links = [
    { from: 0, to: 2, length: crank1Length },
    { from: 2, to: 3, length: coupler1Length },
    { from: 1, to: 3, length: follower1Length },
    { from: 3, to: 5, length: link2aLength },
    { from: 5, to: 6, length: link2bLength },
    { from: 4, to: 6, length: link2cLength },
    { from: 6, to: 8, length: link3aLength },
    { from: 8, to: 9, length: link3bLength },
    { from: 7, to: 9, length: link3cLength },
  ];

  const cranks = [
    { jointIndex: 2, groundIndex: 0, radius: crank1Length, phaseOffset: phaseOffset1 || 0 },
  ];

  const linkage = new Linkage({
    joints, links, cranks, outputJointIndex: 10,
  });

  const originalSolve = linkage.solve.bind(linkage);
  linkage.solve = function (angles) {
    const positions = originalSolve(angles);
    if (!positions) return null;

    const p8 = positions[8];
    const p9 = positions[9];
    const midX = (p8.x + p9.x) / 2;
    const midY = (p8.y + p9.y) / 2;
    const linkAngle = Math.atan2(p9.y - p8.y, p9.x - p8.x);
    const outAngle = linkAngle + (couplerPointAngle || 0);

    positions[10] = {
      x: midX + (couplerPointDist || 0) * Math.cos(outAngle),
      y: midY + (couplerPointDist || 0) * Math.sin(outAngle),
    };

    return positions;
  };

  return linkage;
}
