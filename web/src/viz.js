// Oscilloscope + spectrum drawn from the same master tap the recorder uses
// (see the patched AudioNode.connect in strudel.js) — it shows exactly what
// you hear. Left half: waveform. Right half: FFT bars. The rAF loop only runs
// while the strip is visible.

import { getTap, getAudioContext } from './strudel.js';

let canvas = null;
let g = null;
let analyser = null;
let raf = null;

function ensureAnalyser() {
  if (analyser) return analyser;
  analyser = getAudioContext().createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.82;
  getTap().connect(analyser);
  return analyser;
}

const wave = new Uint8Array(2048);
const freq = new Uint8Array(1024);

function draw() {
  raf = requestAnimationFrame(draw);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  g.clearRect(0, 0, w, h);

  const a = ensureAnalyser();
  a.getByteTimeDomainData(wave);
  a.getByteFrequencyData(freq);

  // scope — left half
  const half = w / 2;
  g.strokeStyle = '#58e6d9';
  g.lineWidth = 1.5 * dpr;
  g.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / wave.length) * (half - 8 * dpr);
    const y = (wave[i] / 255) * h;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();

  // spectrum — right half, log-ish bin grouping so bass doesn't eat the view
  const bars = 64;
  const barW = (half - 8 * dpr) / bars;
  g.fillStyle = '#ff5fa2';
  for (let b = 0; b < bars; b++) {
    const lo = Math.floor((freq.length * b * b) / (bars * bars)); // quadratic spread
    const hi = Math.max(lo + 1, Math.floor((freq.length * (b + 1) * (b + 1)) / (bars * bars)));
    let v = 0;
    for (let i = lo; i < hi; i++) v = Math.max(v, freq[i]);
    const bh = (v / 255) * h;
    g.fillRect(half + 8 * dpr + b * barW, h - bh, barW * 0.7, bh);
  }
}

export function initViz(canvasEl, btn) {
  canvas = canvasEl;
  g = canvas.getContext('2d');
  btn.addEventListener('click', () => {
    const show = canvas.hidden;
    canvas.hidden = !show;
    btn.classList.toggle('playing', show);
    if (show) draw();
    else if (raf) cancelAnimationFrame(raf), (raf = null);
  });
}
