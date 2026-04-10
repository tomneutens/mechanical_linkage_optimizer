import './style.css';
import { CurveEditor } from './curveEditor.js';
import { Visualizer } from './visualizer.js';
import { Optimizer } from './optimizer.js';
import { exportSVG, exportDXF, downloadFile } from './exporter.js';

const svg = document.getElementById('canvas');
const curveEditor = new CurveEditor(svg);
const visualizer = new Visualizer(svg);
const optimizer = new Optimizer();

// UI elements
const btnDraw = document.getElementById('btn-draw');
const btnEdit = document.getElementById('btn-edit');
const btnZones = document.getElementById('btn-zones');
const btnClear = document.getElementById('btn-clear');
const btnClearZones = document.getElementById('btn-clear-zones');
const btnOptimize = document.getElementById('btn-optimize');
const btnAuto = document.getElementById('btn-auto');
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnExportSvg = document.getElementById('btn-export-svg');
const btnExportDxf = document.getElementById('btn-export-dxf');
const complexitySelect = document.getElementById('complexity-select');
const inputCountSelect = document.getElementById('input-count-select');
const iterationsInput = document.getElementById('iterations-input');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');

const statusText = document.getElementById('status-text');
const optimizerPanel = document.getElementById('optimizer-panel');
const progressFill = document.getElementById('progress-fill');
const optimizerStatus = document.getElementById('optimizer-status');
const errorValue = document.getElementById('error-value');
const linkageInfo = document.getElementById('linkage-info');
const linkageType = document.getElementById('linkage-type');
const linkageLinks = document.getElementById('linkage-links');
const linkageError = document.getElementById('linkage-error');

let currentTargetPoints = [];
let currentLinkage = null;

// --- Mode buttons ---
btnDraw.addEventListener('click', () => {
  setMode('draw');
});

btnEdit.addEventListener('click', () => {
  setMode('edit');
});

btnZones.addEventListener('click', () => {
  setMode('zones');
});

btnClear.addEventListener('click', () => {
  curveEditor.clear();
  visualizer.clear();
  currentTargetPoints = [];
  currentLinkage = null;
  linkageInfo.style.display = 'none';
  optimizerPanel.style.display = 'none';
  statusText.textContent = 'Draw a target curve on the canvas to begin.';
});

btnClearZones.addEventListener('click', () => {
  curveEditor.clearZones();
  statusText.textContent = 'Exclusion zones cleared.';
});

function setMode(mode) {
  curveEditor.setMode(mode);
  btnDraw.classList.toggle('active', mode === 'draw');
  btnEdit.classList.toggle('active', mode === 'edit');
  btnZones.classList.toggle('active', mode === 'zones');
  if (mode === 'zones') {
    statusText.textContent = 'Click to place zone vertices. Click near the first vertex to close the zone.';
  }
}

// --- Optimizer ---
btnOptimize.addEventListener('click', async () => {
  await runOptimizer(false);
});

btnAuto.addEventListener('click', async () => {
  await runOptimizer(true);
});

async function runOptimizer(auto) {
  currentTargetPoints = curveEditor.sampleCurve(128);
  if (currentTargetPoints.length < 10) {
    statusText.textContent = 'Draw a curve with at least 3 points first.';
    return;
  }

  const barCount = parseInt(complexitySelect.value);
  const numCranks = parseInt(inputCountSelect.value);
  const iterations = parseInt(iterationsInput.value) || 5000;
  const exclusionZones = curveEditor.getZones();

  // Disable UI during optimization
  btnOptimize.disabled = true;
  btnAuto.disabled = true;
  optimizerPanel.style.display = '';
  linkageInfo.style.display = 'none';
  visualizer.pause();
  btnPlay.disabled = true;
  btnPause.disabled = true;

  optimizer.onProgress = (progress, bestError) => {
    progressFill.style.width = `${(progress * 100).toFixed(1)}%`;
    optimizerStatus.textContent = `${(progress * 100).toFixed(1)}% complete`;
    errorValue.textContent = bestError.toFixed(2);
  };

  statusText.textContent = auto
    ? 'Auto-optimizing: trying simple linkages first...'
    : `Optimizing ${barCount}-bar linkage...`;
  if (exclusionZones.length > 0) {
    statusText.textContent += ` (${exclusionZones.length} exclusion zone${exclusionZones.length > 1 ? 's' : ''})`;
  }

  let result;
  if (auto) {
    result = await optimizer.autoOptimize(currentTargetPoints, numCranks, iterations, exclusionZones);
  } else {
    result = await optimizer.optimize(currentTargetPoints, barCount, numCranks, iterations, exclusionZones);
  }

  currentLinkage = result.linkage;

  // Update UI
  btnOptimize.disabled = false;
  btnAuto.disabled = false;
  btnPlay.disabled = false;
  optimizerPanel.style.display = 'none';

  if (currentLinkage) {
    visualizer.setLinkage(currentLinkage);

    linkageInfo.style.display = '';
    const jointCount = currentLinkage.joints.length;
    const linkCount = currentLinkage.links.length;
    const barStr = linkCount <= 3 ? '4-bar' : linkCount <= 6 ? '6-bar' : '8-bar';
    linkageType.textContent = barStr;
    linkageLinks.textContent = `${linkCount} links, ${jointCount} joints`;
    linkageError.textContent = result.error.toFixed(2);

    statusText.textContent = `Optimization complete! Error: ${result.error.toFixed(2)}. Press Play to animate.`;
  } else {
    statusText.textContent = 'Optimization failed to find a valid linkage. Try different settings.';
  }
}

// --- Animation ---
btnPlay.addEventListener('click', () => {
  if (!currentLinkage) return;
  visualizer.play();
  btnPlay.disabled = true;
  btnPause.disabled = false;
});

btnPause.addEventListener('click', () => {
  visualizer.pause();
  btnPlay.disabled = false;
  btnPause.disabled = true;
});

speedSlider.addEventListener('input', () => {
  const speed = parseFloat(speedSlider.value);
  visualizer.setSpeed(speed);
  speedLabel.textContent = `${speed.toFixed(1)}x`;
});

// --- Export ---
btnExportSvg.addEventListener('click', () => {
  if (!currentLinkage) {
    statusText.textContent = 'Optimize a linkage first before exporting.';
    return;
  }
  const svgContent = exportSVG(currentLinkage, curveEditor.getPathString());
  if (svgContent) {
    downloadFile(svgContent, 'linkage.svg', 'image/svg+xml');
    statusText.textContent = 'SVG exported successfully.';
  }
});

btnExportDxf.addEventListener('click', () => {
  if (!currentLinkage) {
    statusText.textContent = 'Optimize a linkage first before exporting.';
    return;
  }
  const dxfContent = exportDXF(currentLinkage, currentTargetPoints);
  if (dxfContent) {
    downloadFile(dxfContent, 'linkage.dxf', 'application/dxf');
    statusText.textContent = 'DXF exported successfully.';
  }
});
