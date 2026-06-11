// Strudel engine wiring — vendored from @strudel/web's web.mjs (AGPL-3.0),
// with one change: registerSoundfonts() is enabled, so the 128 gm_* General
// MIDI voices land in the SAME sound registry as everything else. Importing
// the prebuilt @strudel/web bundle alongside @strudel/soundfonts gives two
// copies of the registry and the gm_ sounds silently vanish.

import { Pattern, evalScope, setTime } from '@strudel/core';
import {
  getAudioContext,
  initAudioOnFirstClick,
  registerSynthSounds,
  webaudioRepl,
} from '@strudel/webaudio';
import { registerSoundfonts } from '@strudel/soundfonts';
import { transpiler } from '@strudel/transpiler';
import { miniAllStrings } from '@strudel/mini';
import { slider, sliderWithID } from './sliders.js';

export {
  samples,
  getAudioContext,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
  initAudio,
} from '@strudel/webaudio';

// --- master tap for the recorder -------------------------------------------
// Patch AudioNode.connect so everything that reaches the context destination
// also feeds a tap GainNode — the recorder hears exactly what the user hears.
// Nodes registered via excludeFromTap (the recorder itself) are skipped so we
// don't create a tap → recorder → tap cycle.
let tap = null;
const tapExcluded = new WeakSet();

export function getTap() {
  // offline WAV rendering closes the live context and a fresh one is created
  // lazily afterwards — the tap must follow, or recorder/viz go deaf
  if (!tap || tap.context !== getAudioContext()) tap = getAudioContext().createGain();
  return tap;
}

export function excludeFromTap(node) {
  tapExcluded.add(node);
}

// --- node-pool poisoning guard ----------------------------------------------
// superdough pools filter/compressor nodes in a module-global pool keyed by a
// 'nodePoolKey' Symbol — but NOT by AudioContext. With offline rendering the
// pool recycles nodes across contexts (live→offline, chunk→chunk, offline→
// live), and every voice that receives a foreign-context node dies with
// "cannot connect to an AudioNode belonging to a different audio context".
// releaseNodeToPool() calls node.disconnect() BEFORE reading the pool key, so
// stripping the key here keeps every node out of the pool. Costs the pooling
// micro-optimization, buys correct renders.
const origDisconnect = AudioNode.prototype.disconnect;
AudioNode.prototype.disconnect = function (...args) {
  for (const sym of Object.getOwnPropertySymbols(this)) {
    if (sym.description === 'nodePoolKey') delete this[sym];
  }
  return origDisconnect.apply(this, args);
};

const origConnect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (dest, ...args) {
  const ret = origConnect.call(this, dest, ...args);
  try {
    if (dest === getAudioContext().destination && !tapExcluded.has(this) && this !== getTap()) {
      origConnect.call(this, getTap());
    }
  } catch {
    /* tap is best-effort — never break audio */
  }
  return ret;
};

async function defaultPrebake() {
  const loadModules = evalScope(
    evalScope,
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('@strudel/webaudio'),
    { hush, evaluate, slider, sliderWithID },
  );
  await Promise.all([loadModules, registerSynthSounds(), registerSoundfonts()]);
}

let initDone;
let repl;

export function initStrudel(options = {}) {
  initAudioOnFirstClick();
  options.miniAllStrings !== false && miniAllStrings();
  const { prebake, ...replOptions } = options;
  repl = webaudioRepl({
    ...replOptions,
    transpiler,
    // resolve the context per call — webaudioRepl's default captures the boot
    // context, which offline rendering closes and replaces
    getTime: () => getAudioContext().currentTime,
  });
  initDone = (async () => {
    await defaultPrebake();
    await prebake?.();
    return repl;
  })();
  setTime(() => repl.scheduler.now());
  return initDone;
}

Pattern.prototype.play = function () {
  if (!repl) {
    throw new Error('.play: no repl found. Have you called initStrudel?');
  }
  initDone.then(() => {
    repl.setPattern(this, true);
  });
  return this;
};

export function hush() {
  repl.stop();
}

export function getRepl() {
  return repl;
}

export async function evaluate(code, autoplay = true) {
  return repl.evaluate(code, autoplay);
}
