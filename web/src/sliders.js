// slider(value, min, max, step?) — strudel.cc-compatible live slider widgets.
// Each call site becomes a range input in the #sliders strip and returns a
// continuous signal Pattern that reads the widget on every query, so dragging
// changes the sound within the scheduler lookahead — no re-eval needed.
//
// Identity is the call ORDER within one eval (slider #1, #2, …). On hot reload
// a slider keeps its user-tweaked value as long as its (default, min, max,
// step) in the code are unchanged; editing any of them in the code resets the
// widget to the new default. Switching tracks clears the strip.

import { signal } from '@strudel/core';

let panel = null;
let registry = []; // [{ current, def, min, max, step, el, input, readout }]
let cursor = 0; // call index within the current eval

export function bindSliderPanel(elPanel) {
  panel = elPanel;
}

const fmt = (v, min, max) => (max - min >= 100 ? v.toFixed(1) : v.toFixed(3));

function createWidget(i, value, min, max, step) {
  const s = { current: value, def: value, min, max, step, el: null, input: null, readout: null };
  if (!panel) return s; // headless (tests) — value still works, no UI
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const label = document.createElement('span');
  label.className = 'slabel';
  label.textContent = `s${i + 1}`;
  label.title = 'click, then move a MIDI control to bind it to this slider';
  label.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('slider-learn', { detail: { index: i, el: wrap } })),
  );
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step ?? (max - min) / 1000;
  input.value = value;
  const readout = document.createElement('span');
  readout.className = 'sval';
  readout.textContent = fmt(value, min, max);
  input.addEventListener('input', () => {
    s.current = parseFloat(input.value);
    readout.textContent = fmt(s.current, min, max);
  });
  wrap.append(label, input, readout);
  const next = registry[i + 1]?.el;
  next ? panel.insertBefore(wrap, next) : panel.appendChild(wrap);
  s.el = wrap;
  s.input = input;
  s.readout = readout;
  return s;
}

export function slider(value = 0, min = 0, max = 1, step) {
  const i = cursor++;
  let s = registry[i];
  const changed = !s || s.def !== value || s.min !== min || s.max !== max || s.step !== step;
  if (changed) {
    s?.el?.remove();
    s = createWidget(i, value, min, max, step);
    registry[i] = s;
  }
  const ref = s;
  return signal(() => ref.current);
}

// The @strudel/transpiler rewrites every `slider(...)` call in track code to
// `sliderWithID('<source-id>', ...)`. We match widgets by call ORDER instead
// (stable when code above shifts offsets), so the id is ignored.
export function sliderWithID(id, value, min, max, step) {
  return slider(value, min, max, step);
}

// evalCode wraps each evaluation so widgets from removed slider() calls vanish
export function beginSliderEval() {
  cursor = 0;
}

export function endSliderEval() {
  for (let i = cursor; i < registry.length; i++) registry[i].el?.remove();
  registry.length = cursor;
  if (panel) panel.hidden = registry.length === 0;
}

// drive a slider from outside the UI (MIDI) — t is normalized 0..1
export function setSliderNormalized(i, t) {
  const s = registry[i];
  if (!s) return false;
  let v = s.min + (s.max - s.min) * Math.min(1, Math.max(0, t));
  if (s.step) v = Math.round(v / s.step) * s.step;
  s.current = v;
  if (s.input) {
    s.input.value = v;
    s.readout.textContent = fmt(v, s.min, s.max);
  }
  return true;
}

export function clearSliders() {
  for (const s of registry) s.el?.remove();
  registry.length = 0;
  cursor = 0;
  if (panel) panel.hidden = true;
}
