/**
 * Linkage Visualizer — renders a linkage mechanism in SVG
 * and animates it through its motion cycle.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Visualizer {
  constructor(svg) {
    this.svg = svg;
    this.linkageLayer = svg.querySelector('#layer-linkage');
    this.traceLayer = svg.querySelector('#layer-output-trace');
    this.linkage = null;
    this.animating = false;
    this.angle = 0;
    this.speed = 1;
    this._rafId = null;
    this._tracePoints = [];
  }

  setLinkage(linkage) {
    this.linkage = linkage;
    this._tracePoints = [];
    this.angle = 0;
    this.renderTrace();
    this.renderStaticLinkage();
  }

  /** Render the full output trace of the linkage */
  renderTrace() {
    this.traceLayer.innerHTML = '';
    if (!this.linkage) return;

    const trace = this.linkage.traceOutput(256);
    if (trace.length < 2) return;

    const d = `M ${trace[0].x} ${trace[0].y} ` +
      trace.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z';

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'output-trace');
    this.traceLayer.appendChild(path);
  }

  /** Render the linkage at its current angle */
  renderStaticLinkage() {
    this.linkageLayer.innerHTML = '';
    if (!this.linkage) return;

    const angles = this.linkage.cranks.map((_, i) =>
      i === 0 ? this.angle : this.angle * (i + 1)
    );
    const positions = this.linkage.solve(angles);
    if (!positions) return;

    this._drawLinkage(positions);
  }

  _drawLinkage(positions) {
    const linkage = this.linkage;

    // Draw crank rotation indicators
    for (const crank of linkage.cranks) {
      const g = positions[crank.groundIndex];
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', g.x);
      circle.setAttribute('cy', g.y);
      circle.setAttribute('r', crank.radius);
      circle.setAttribute('class', 'crank-indicator');
      this.linkageLayer.appendChild(circle);
    }

    // Draw links
    for (const link of linkage.links) {
      const p1 = positions[link.from];
      const p2 = positions[link.to];
      if (!p1 || !p2) continue;

      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', p1.x);
      line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x);
      line.setAttribute('y2', p2.y);
      line.setAttribute('class', 'linkage-link');
      this.linkageLayer.appendChild(line);
    }

    // If there's a coupler point, draw the coupler triangle
    const outputIdx = linkage.outputJointIndex;
    const outputPos = positions[outputIdx];

    // Draw joints
    for (let i = 0; i < linkage.joints.length; i++) {
      const joint = linkage.joints[i];
      const pos = positions[i];
      if (!pos) continue;

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);

      if (i === outputIdx) {
        circle.setAttribute('r', 6);
        circle.setAttribute('class', 'linkage-output');
      } else if (joint.type === 'ground') {
        circle.setAttribute('r', 5);
        circle.setAttribute('class', 'linkage-ground');
        // Draw ground symbol
        this._drawGroundSymbol(pos);
      } else {
        circle.setAttribute('r', 4);
        circle.setAttribute('class', 'linkage-joint');
      }

      this.linkageLayer.appendChild(circle);
    }

    // Draw line from nearest coupler link midpoint to output point
    if (outputPos) {
      // Find two joints connected to form the coupler (heuristic: second link's endpoints)
      const connLinks = linkage.links.filter(l =>
        l.from !== outputIdx && l.to !== outputIdx
      );
      if (connLinks.length >= 2) {
        const couplerLink = connLinks[1]; // the coupler
        const p2 = positions[couplerLink.from];
        const p3 = positions[couplerLink.to];
        if (p2 && p3) {
          const midX = (p2.x + p3.x) / 2;
          const midY = (p2.y + p3.y) / 2;
          const line = document.createElementNS(SVG_NS, 'line');
          line.setAttribute('x1', midX);
          line.setAttribute('y1', midY);
          line.setAttribute('x2', outputPos.x);
          line.setAttribute('y2', outputPos.y);
          line.setAttribute('stroke', '#95a5a6');
          line.setAttribute('stroke-width', '1.5');
          line.setAttribute('stroke-dasharray', '4,2');
          this.linkageLayer.appendChild(line);
        }
      }
    }
  }

  _drawGroundSymbol(pos) {
    const size = 10;
    const g = document.createElementNS(SVG_NS, 'g');

    // Hatching lines below the ground point
    for (let i = -2; i <= 2; i++) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', pos.x + i * 4 - 3);
      line.setAttribute('y1', pos.y + size + 2);
      line.setAttribute('x2', pos.x + i * 4 + 3);
      line.setAttribute('y2', pos.y + size - 2);
      line.setAttribute('stroke', '#e67e22');
      line.setAttribute('stroke-width', '1');
      g.appendChild(line);
    }

    // Ground base line
    const baseLine = document.createElementNS(SVG_NS, 'line');
    baseLine.setAttribute('x1', pos.x - size);
    baseLine.setAttribute('y1', pos.y + size / 2);
    baseLine.setAttribute('x2', pos.x + size);
    baseLine.setAttribute('y2', pos.y + size / 2);
    baseLine.setAttribute('stroke', '#e67e22');
    baseLine.setAttribute('stroke-width', '1.5');
    g.appendChild(baseLine);

    this.linkageLayer.appendChild(g);
  }

  play() {
    if (this.animating) return;
    this.animating = true;
    this._tracePoints = [];
    this._lastTime = performance.now();
    this._animate();
  }

  pause() {
    this.animating = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  _animate() {
    if (!this.animating) return;

    const now = performance.now();
    const dt = (now - this._lastTime) / 1000;
    this._lastTime = now;

    this.angle += dt * this.speed * 2; // ~1 revolution per second at speed=1
    if (this.angle > 2 * Math.PI) {
      this.angle -= 2 * Math.PI;
    }

    this.renderStaticLinkage();

    this._rafId = requestAnimationFrame(() => this._animate());
  }

  clear() {
    this.linkageLayer.innerHTML = '';
    this.traceLayer.innerHTML = '';
    this.linkage = null;
  }

  /** Get all positions at current angle for export */
  getCurrentPositions() {
    if (!this.linkage) return null;
    const angles = this.linkage.cranks.map((_, i) =>
      i === 0 ? this.angle : this.angle * (i + 1)
    );
    return this.linkage.solve(angles);
  }
}
