/**
 * Exporter — SVG and DXF export for the linkage mechanism.
 */

/**
 * Export the linkage as an SVG file.
 * Includes: the linkage at its current position, the output trace, and the target curve.
 */
export function exportSVG(linkage, targetPathStr) {
  if (!linkage) return null;

  const trace = linkage.traceOutput(256);
  const positions = linkage.solve(linkage.cranks.map(() => 0));
  if (!positions) return null;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <style>
    .link { stroke: #2c3e50; stroke-width: 3; stroke-linecap: round; fill: none; }
    .joint { fill: #3498db; stroke: #2c3e50; stroke-width: 1.5; }
    .ground { fill: #e67e22; stroke: #2c3e50; stroke-width: 1.5; }
    .output-joint { fill: #e74c3c; stroke: #fff; stroke-width: 2; }
    .trace { fill: none; stroke: #27ae60; stroke-width: 2; }
    .target { fill: none; stroke: #e74c3c; stroke-width: 2; stroke-dasharray: 6,3; }
  </style>
`;

  // Target curve
  if (targetPathStr) {
    svg += `  <path d="${escapeXml(targetPathStr)}" class="target" />\n`;
  }

  // Output trace
  if (trace.length > 1) {
    const d = `M ${trace[0].x.toFixed(2)} ${trace[0].y.toFixed(2)} ` +
      trace.slice(1).map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
    svg += `  <path d="${d}" class="trace" />\n`;
  }

  // Links
  for (const link of linkage.links) {
    const p1 = positions[link.from];
    const p2 = positions[link.to];
    if (p1 && p2) {
      svg += `  <line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" class="link" />\n`;
    }
  }

  // Joints
  for (let i = 0; i < linkage.joints.length; i++) {
    const j = linkage.joints[i];
    const p = positions[i];
    if (!p) continue;

    const cls = i === linkage.outputJointIndex ? 'output-joint' :
      j.type === 'ground' ? 'ground' : 'joint';
    const r = i === linkage.outputJointIndex ? 6 : j.type === 'ground' ? 5 : 4;
    svg += `  <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r}" class="${cls}" />\n`;
  }

  svg += '</svg>';
  return svg;
}

/**
 * Export the linkage as a DXF file (AutoCAD R12 format).
 * Includes links as LINE entities, joints as CIRCLE entities, and the trace as a POLYLINE.
 */
export function exportDXF(linkage, targetPoints) {
  if (!linkage) return null;

  const trace = linkage.traceOutput(256);
  const positions = linkage.solve(linkage.cranks.map(() => 0));
  if (!positions) return null;

  let dxf = `0\nSECTION\n2\nHEADER\n0\nENDSEC\n`;
  dxf += `0\nSECTION\n2\nTABLES\n`;
  dxf += `0\nTABLE\n2\nLAYER\n70\n4\n`;
  dxf += dxfLayer('LINKAGE', 7);
  dxf += dxfLayer('TRACE', 3);
  dxf += dxfLayer('TARGET', 1);
  dxf += dxfLayer('JOINTS', 5);
  dxf += `0\nENDTAB\n0\nENDSEC\n`;
  dxf += `0\nSECTION\n2\nENTITIES\n`;

  // Links as LINE entities
  for (const link of linkage.links) {
    const p1 = positions[link.from];
    const p2 = positions[link.to];
    if (p1 && p2) {
      dxf += dxfLine(p1.x, -p1.y, p2.x, -p2.y, 'LINKAGE');
    }
  }

  // Joints as CIRCLE entities
  for (let i = 0; i < linkage.joints.length; i++) {
    const p = positions[i];
    if (!p) continue;
    const r = linkage.joints[i].type === 'ground' ? 5 : 4;
    dxf += dxfCircle(p.x, -p.y, r, 'JOINTS');
  }

  // Output trace as POLYLINE
  if (trace.length > 1) {
    dxf += dxfPolyline(trace.map(p => ({ x: p.x, y: -p.y })), 'TRACE', true);
  }

  // Target curve as POLYLINE
  if (targetPoints && targetPoints.length > 1) {
    dxf += dxfPolyline(targetPoints.map(p => ({ x: p.x, y: -p.y })), 'TARGET', false);
  }

  dxf += `0\nENDSEC\n0\nEOF\n`;
  return dxf;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function dxfLayer(name, color) {
  return `0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS\n`;
}

function dxfLine(x1, y1, x2, y2, layer) {
  return `0\nLINE\n8\n${layer}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0\n`;
}

function dxfCircle(x, y, r, layer) {
  return `0\nCIRCLE\n8\n${layer}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0\n40\n${r.toFixed(4)}\n`;
}

function dxfPolyline(points, layer, closed) {
  let s = `0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${closed ? 1 : 0}\n`;
  for (const p of points) {
    s += `0\nVERTEX\n8\n${layer}\n10\n${p.x.toFixed(4)}\n20\n${p.y.toFixed(4)}\n30\n0\n`;
  }
  s += `0\nSEQEND\n8\n${layer}\n`;
  return s;
}

/** Trigger a file download in the browser */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
