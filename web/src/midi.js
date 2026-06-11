// Web MIDI → slider() widgets. MIDI-learn workflow: click a slider's label
// (it pulses), move a knob/fader on your controller, done — that CC now drives
// the slider. Bindings are by slider POSITION (s1, s2, …) and persist in
// localStorage, so the same knob keeps working across hot reloads and tracks.
// Click the label again to cancel learn; learn a bound CC onto another slider
// to move the binding.

import { setSliderNormalized } from './sliders.js';

const LS_KEY = 'strudel-player-midi-bindings';
let bindings = {};
try {
  bindings = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
} catch {
  /* corrupt storage — start fresh */
}

let learn = null; // {index, el} of the slider awaiting a CC
let onStatus = () => {};

document.addEventListener('slider-learn', (e) => {
  learn?.el.classList.remove('learning');
  if (learn?.index === e.detail.index) {
    learn = null; // second click on the same label cancels
    onStatus('midi learn cancelled');
    return;
  }
  learn = e.detail;
  learn.el.classList.add('learning');
  onStatus(`midi learn: move a control to bind s${learn.index + 1}`);
});

function onMessage(msg) {
  const [status, d1, d2] = msg.data;
  if ((status & 0xf0) !== 0xb0) return; // control-change only
  const key = `${status & 0x0f}:${d1}`; // channel:cc
  if (learn) {
    // a binding follows the slider it was learned onto last
    for (const k of Object.keys(bindings)) if (bindings[k] === learn.index) delete bindings[k];
    bindings[key] = learn.index;
    localStorage.setItem(LS_KEY, JSON.stringify(bindings));
    learn.el.classList.remove('learning');
    onStatus(`bound ch${(status & 0x0f) + 1} cc${d1} → s${learn.index + 1}`);
    learn = null;
  }
  const idx = bindings[key];
  if (idx !== undefined) setSliderNormalized(idx, d2 / 127);
}

export function initMidi(statusCb) {
  if (statusCb) onStatus = statusCb;
  if (!navigator.requestMIDIAccess) return; // not a secure context / no support
  navigator
    .requestMIDIAccess()
    .then((access) => {
      const hookInputs = () => {
        for (const input of access.inputs.values()) input.onmidimessage = onMessage;
      };
      hookInputs();
      access.onstatechange = hookInputs; // hot-plugged controllers
    })
    .catch((e) => console.warn('midi unavailable:', e));
}
