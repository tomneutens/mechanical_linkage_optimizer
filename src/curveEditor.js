/**
 * Curve Editor — SVG-based Bezier curve drawing and editing.
 * Users click to place anchor points; cubic bezier control handles
 * are generated automatically and can be dragged in edit mode.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export class CurveEditor {
  constructor(svg) {
    this.svg = svg;
    this.targetLayer = svg.querySelector('#layer-target');
    this.handleLayer = svg.querySelector('#layer-handles');
    this.zoneLayer = svg.querySelector('#layer-zones');

    // Each node: { x, y, cx1, cy1, cx2, cy2 } — anchor + in/out handles
    this.nodes = [];
    this.closed = false;
    this.mode = 'draw'; // 'draw' | 'edit' | 'zones'

    // Exclusion zones: array of { vertices: [{x,y}, ...], closed: bool }
    this.zones = [];
    this._currentZone = null; // zone being drawn (not yet closed)

    this._dragTarget = null;
    this._dragType = null; // 'anchor' | 'handle-in' | 'handle-out' | 'zone-vertex'
    this._dragIndex = -1;
    this._dragZoneIndex = -1;

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    svg.addEventListener('mousedown', this._onMouseDown);
    svg.addEventListener('mousemove', this._onMouseMove);
    svg.addEventListener('mouseup', this._onMouseUp);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'zones') {
      this.svg.style.cursor = 'crosshair';
    } else if (mode === 'draw') {
      this.svg.style.cursor = 'crosshair';
    } else {
      this.svg.style.cursor = 'default';
    }
    // If switching away from zones mode, finalize any incomplete zone
    if (mode !== 'zones' && this._currentZone) {
      if (this._currentZone.vertices.length >= 3) {
        this._currentZone.closed = true;
        this.zones.push(this._currentZone);
      }
      this._currentZone = null;
    }
    this.render();
  }

  clear() {
    this.nodes = [];
    this.closed = false;
    this.render();
  }

  clearZones() {
    this.zones = [];
    this._currentZone = null;
    this.renderZones();
  }

  getZones() {
    return this.zones.filter(z => z.closed && z.vertices.length >= 3);
  }

  /** Convert SVG mouse event to SVG coordinate space */
  _svgPoint(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = this.svg.getScreenCTM().inverse();
    const svgP = pt.matrixTransform(ctm);
    return { x: svgP.x, y: svgP.y };
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const p = this._svgPoint(e);

    if (this.mode === 'draw') {
      this._addPoint(p);
      return;
    }

    if (this.mode === 'zones') {
      this._addZoneVertex(p);
      return;
    }

    // Edit mode: check if clicking an existing handle or zone vertex
    const zoneHit = this._hitTestZones(p);
    if (zoneHit) {
      this._dragTarget = zoneHit;
      this._dragType = 'zone-vertex';
      this._dragZoneIndex = zoneHit.zoneIndex;
      this._dragIndex = zoneHit.vertexIndex;
      e.preventDefault();
      return;
    }

    const hit = this._hitTest(p);
    if (hit) {
      this._dragTarget = hit;
      this._dragType = hit.type;
      this._dragIndex = hit.index;
      e.preventDefault();
    }
  }

  _onMouseMove(e) {
    if (!this._dragTarget) return;
    const p = this._svgPoint(e);

    if (this._dragType === 'zone-vertex') {
      const zone = this.zones[this._dragZoneIndex];
      zone.vertices[this._dragIndex] = { x: p.x, y: p.y };
      this.renderZones();
      return;
    }

    const node = this.nodes[this._dragIndex];

    if (this._dragType === 'anchor') {
      const dx = p.x - node.x;
      const dy = p.y - node.y;
      node.x = p.x;
      node.y = p.y;
      node.cx1 += dx;
      node.cy1 += dy;
      node.cx2 += dx;
      node.cy2 += dy;
    } else if (this._dragType === 'handle-in') {
      node.cx1 = p.x;
      node.cy1 = p.y;
      // Mirror the other handle
      node.cx2 = 2 * node.x - p.x;
      node.cy2 = 2 * node.y - p.y;
    } else if (this._dragType === 'handle-out') {
      node.cx2 = p.x;
      node.cy2 = p.y;
      node.cx1 = 2 * node.x - p.x;
      node.cy1 = 2 * node.y - p.y;
    }

    this.render();
  }

  _onMouseUp() {
    this._dragTarget = null;
    this._dragType = null;
    this._dragIndex = -1;
    this._dragZoneIndex = -1;
  }

  // --- Zone drawing ---
  _addZoneVertex(p) {
    if (!this._currentZone) {
      this._currentZone = { vertices: [p], closed: false };
    } else {
      // Check if clicking near the first vertex to close the zone
      const first = this._currentZone.vertices[0];
      if (this._currentZone.vertices.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < 15) {
        this._currentZone.closed = true;
        this.zones.push(this._currentZone);
        this._currentZone = null;
      } else {
        this._currentZone.vertices.push(p);
      }
    }
    this.renderZones();
  }

  _hitTestZones(p) {
    const threshold = 10;
    for (let zi = 0; zi < this.zones.length; zi++) {
      const zone = this.zones[zi];
      for (let vi = 0; vi < zone.vertices.length; vi++) {
        const v = zone.vertices[vi];
        if (Math.hypot(p.x - v.x, p.y - v.y) < threshold) {
          return { zoneIndex: zi, vertexIndex: vi };
        }
      }
    }
    return null;
  }

  _addPoint(p) {
    // If clicking near the first point and we have >=3 points, close the curve
    if (this.nodes.length >= 3) {
      const first = this.nodes[0];
      const dist = Math.hypot(p.x - first.x, p.y - first.y);
      if (dist < 15) {
        this.closed = true;
        this.render();
        return;
      }
    }

    const prev = this.nodes.length > 0 ? this.nodes[this.nodes.length - 1] : null;
    const dx = prev ? (p.x - prev.x) * 0.3 : 20;
    const dy = prev ? (p.y - prev.y) * 0.3 : 0;

    this.nodes.push({
      x: p.x, y: p.y,
      cx1: p.x - dx, cy1: p.y - dy,
      cx2: p.x + dx, cy2: p.y + dy,
    });

    this.render();
  }

  _hitTest(p) {
    const threshold = 10;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (Math.hypot(p.x - n.x, p.y - n.y) < threshold) {
        return { type: 'anchor', index: i };
      }
      if (Math.hypot(p.x - n.cx1, p.y - n.cy1) < threshold) {
        return { type: 'handle-in', index: i };
      }
      if (Math.hypot(p.x - n.cx2, p.y - n.cy2) < threshold) {
        return { type: 'handle-out', index: i };
      }
    }
    return null;
  }

  /** Render the curve and handles to SVG */
  render() {
    this.targetLayer.innerHTML = '';
    this.handleLayer.innerHTML = '';

    if (this.nodes.length === 0) return;

    // Build path
    const pathStr = this._buildPathString();
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathStr);
    path.setAttribute('class', 'target-curve');
    this.targetLayer.appendChild(path);

    // Draw handles in edit mode
    if (this.mode === 'edit') {
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];

        // Handle lines
        const line1 = document.createElementNS(SVG_NS, 'line');
        line1.setAttribute('x1', n.x); line1.setAttribute('y1', n.y);
        line1.setAttribute('x2', n.cx1); line1.setAttribute('y2', n.cy1);
        line1.setAttribute('class', 'control-line');
        this.handleLayer.appendChild(line1);

        const line2 = document.createElementNS(SVG_NS, 'line');
        line2.setAttribute('x1', n.x); line2.setAttribute('y1', n.y);
        line2.setAttribute('x2', n.cx2); line2.setAttribute('y2', n.cy2);
        line2.setAttribute('class', 'control-line');
        this.handleLayer.appendChild(line2);

        // Handle circles
        this._createCircle(n.cx1, n.cy1, 4, 'control-handle');
        this._createCircle(n.cx2, n.cy2, 4, 'control-handle');
      }
    }

    // Anchor points (always visible)
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      this._createCircle(n.x, n.y, 5, 'target-point');
    }

    this.renderZones();
  }

  /** Render all exclusion zones and the zone currently being drawn */
  renderZones() {
    this.zoneLayer.innerHTML = '';

    // Draw completed zones
    for (let zi = 0; zi < this.zones.length; zi++) {
      const zone = this.zones[zi];
      this._drawZonePolygon(zone, zi);
    }

    // Draw in-progress zone
    if (this._currentZone && this._currentZone.vertices.length > 0) {
      this._drawZonePolygon(this._currentZone, -1);
    }
  }

  _drawZonePolygon(zone, zoneIndex) {
    const verts = zone.vertices;
    if (verts.length === 0) return;

    // Draw filled polygon
    if (verts.length >= 2) {
      const d = `M ${verts[0].x} ${verts[0].y} ` +
        verts.slice(1).map(v => `L ${v.x} ${v.y}`).join(' ') +
        (zone.closed ? ' Z' : '');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', zone.closed ? 'exclusion-zone' : 'exclusion-zone-open');
      this.zoneLayer.appendChild(path);
    }

    // Draw vertices (in zones or edit mode)
    if (this.mode === 'zones' || this.mode === 'edit') {
      for (let vi = 0; vi < verts.length; vi++) {
        const v = verts[vi];
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', v.x);
        circle.setAttribute('cy', v.y);
        circle.setAttribute('r', vi === 0 && !zone.closed ? 6 : 4);
        circle.setAttribute('class', 'zone-vertex');
        this.zoneLayer.appendChild(circle);
      }
    }
  }

  _createCircle(cx, cy, r, cls) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', r);
    c.setAttribute('class', cls);
    this.handleLayer.appendChild(c);
    return c;
  }

  _buildPathString() {
    if (this.nodes.length === 0) return '';
    const nodes = this.nodes;
    let d = `M ${nodes[0].x} ${nodes[0].y}`;

    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];
      d += ` C ${prev.cx2} ${prev.cy2}, ${curr.cx1} ${curr.cy1}, ${curr.x} ${curr.y}`;
    }

    if (this.closed && nodes.length > 1) {
      const last = nodes[nodes.length - 1];
      const first = nodes[0];
      d += ` C ${last.cx2} ${last.cy2}, ${first.cx1} ${first.cy1}, ${first.x} ${first.y}`;
      d += ' Z';
    }

    return d;
  }

  /** Sample the bezier curve at N evenly spaced parameter values.
   *  Returns array of {x, y} points. */
  sampleCurve(numSamples = 128) {
    if (this.nodes.length < 2) return [];

    const segments = [];
    for (let i = 1; i < this.nodes.length; i++) {
      segments.push({ from: this.nodes[i - 1], to: this.nodes[i] });
    }
    if (this.closed && this.nodes.length > 1) {
      segments.push({ from: this.nodes[this.nodes.length - 1], to: this.nodes[0] });
    }

    const totalSegments = segments.length;
    const samplesPerSegment = Math.max(2, Math.floor(numSamples / totalSegments));
    const points = [];

    for (let s = 0; s < totalSegments; s++) {
      const seg = segments[s];
      const count = (s === totalSegments - 1)
        ? numSamples - points.length
        : samplesPerSegment;

      for (let i = 0; i < count; i++) {
        const t = i / count;
        const p = cubicBezier(
          seg.from.x, seg.from.y,
          seg.from.cx2, seg.from.cy2,
          seg.to.cx1, seg.to.cy1,
          seg.to.x, seg.to.y, t
        );
        points.push(p);
      }
    }

    return points;
  }

  getPathString() {
    return this._buildPathString();
  }
}

function cubicBezier(x0, y0, x1, y1, x2, y2, x3, y3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3,
    y: mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3,
  };
}
