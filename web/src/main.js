import { initStrudel, samples, evaluate, hush, getRepl, initAudio } from './strudel.js';
import { isRecording, startRecording, stopRecording } from './recorder.js';
import { bindSliderPanel, beginSliderEval, endSliderEval, clearSliders } from './sliders.js';
import { initMidi } from './midi.js';
import { initViz } from './viz.js';
import {
  createEditor,
  getCode,
  setCode,
  getView,
  setMiniLocations,
  startHighlight,
  stopHighlight,
  invalidateHighlight,
} from './editor.js';

const TRACK_POLL_MS = 700;
const LIST_POLL_MS = 2500;

const el = {
  play: document.getElementById('play'),
  stop: document.getElementById('stop'),
  rec: document.getElementById('rec'),
  dl: document.getElementById('dl'),
  status: document.getElementById('status'),
  tracklist: document.getElementById('tracklist'),
  trackname: document.getElementById('trackname'),
  editor: document.getElementById('editor'),
  error: document.getElementById('error'),
  sounds: document.getElementById('sounds'),
  sliders: document.getElementById('sliders'),
};
bindSliderPanel(el.sliders);
initMidi((msg) => setStatus(msg));
initViz(document.getElementById('viz'), document.getElementById('vizbtn'));

const state = {
  ready: false,
  playing: false,
  track: null, // current track filename
  code: '', // last seen content of the current track ON DISK
  tracks: [],
  dirty: false, // editor has keystrokes not yet written to disk
};

const setStatus = (msg) => (el.status.textContent = msg);
const showError = (err) => {
  el.error.textContent = String(err?.message || err);
  el.error.hidden = false;
};
const clearError = () => (el.error.hidden = true);

// --- boot the engine + sample banks ----------------------------------------
// The pack list lives in public/player.config.json so forks can swap sample
// libraries without touching code; these defaults apply when it's missing.
const DEFAULT_PACKS = [
  'https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json',
  'https://raw.githubusercontent.com/felixroos/dough-samples/main/Dirt-Samples.json',
  'github:tidalcycles/Dirt-Samples',
];

const load = (src) =>
  samples(src).catch((e) => console.warn(`samples(${src}) failed:`, e));

async function loadConfig() {
  try {
    const res = await fetch('/player.config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return {};
  }
}

const booted = initStrudel({
  onEvalError: (e) => {
    console.error(e);
    showError(e);
    setStatus(`eval error in ${state.track}`);
  },
  afterEval: ({ meta }) => setMiniLocations(meta?.miniLocations),
  onToggle: (started) => (started ? startHighlight(getRepl().scheduler) : stopHighlight()),
  prebake: async () => {
    const config = await loadConfig();
    const packs = config.samplePacks || DEFAULT_PACKS;
    await Promise.all(packs.map(load));
  },
});

booted.then(() => {
  state.ready = true;
  el.play.disabled = false;
  el.stop.disabled = false;
  setStatus('ready — pick a track and press play');
});

// --- live "what is playing right now" view ---------------------------------
// Pattern-fragment highlighting lives in the CodeMirror editor (editor.js,
// driven by transpiler miniLocations + a Drawer). The chips strip is fed by a
// non-dominant onTrigger hook (false keeps the default audio output alive).

const chips = new Map(); // sound name -> {el, timer}

// One canonical name per voice. At query time a hap has {s: 'hh', bank:
// 'RolandTR808'}; superdough then mutates s to 'RolandTR808_hh' in place at
// trigger time — so depending on when you look, either form appears. Normalize
// both to the prefixed form for chips AND the mixer filter.
const soundKey = (v) => {
  if (!v?.s) return undefined;
  return v.bank && !v.s.startsWith(`${v.bank}_`) ? `${v.bank}_${v.s}` : v.s;
};

// --- chip mixer: click a chip to mute that voice, alt/cmd-click to solo ------
const muted = new Set();
let soloed = null;

const chipSilenced = (name) => (soloed ? name !== soloed : muted.has(name));

function updateChipStyles() {
  for (const [name, chip] of chips) {
    chip.el.classList.toggle('muted', chipSilenced(name));
    chip.el.classList.toggle('solo', soloed === name);
  }
}

function toggleChip(name, wantSolo) {
  if (wantSolo) soloed = soloed === name ? null : name;
  else muted.has(name) ? muted.delete(name) : muted.add(name);
  updateChipStyles();
  applyMixer();
}

function flashChip(name, durMs) {
  if (!name) return;
  let chip = chips.get(name);
  if (!chip) {
    const div = document.createElement('span');
    div.className = 'chip';
    div.textContent = name;
    div.title = 'click: mute · alt-click: solo';
    div.addEventListener('click', (e) => toggleChip(name, e.altKey || e.metaKey));
    el.sounds.appendChild(div);
    chip = { el: div, timer: null };
    chips.set(name, chip);
    updateChipStyles();
  }
  chip.el.classList.add('on');
  clearTimeout(chip.timer);
  chip.timer = setTimeout(() => {
    chip.el.classList.remove('on');
    // drop chips that stayed silent for a while (section changed) — but keep
    // the board stable while the mixer is engaged, or muted voices would lose
    // their only unmute handle
    chip.timer = setTimeout(() => {
      if (muted.size || soloed) return;
      chip.el.remove();
      chips.delete(name);
    }, 4000);
  }, Math.max(150, durMs));
}

function clearChips() {
  for (const { el: c, timer } of chips.values()) {
    clearTimeout(timer);
    c.remove();
  }
  chips.clear();
}

// signature per @strudel/core: (hap, currentTime, cps, targetTime)
function onTrig(hap, currentTime, cps, targetTime) {
  const delayMs = Math.max(0, (targetTime - currentTime) * 1000);
  const durMs = Math.max(120, ((hap.duration || 0.1) / cps) * 1000 * 0.9);
  const sound = soundKey(hap.value); // resolve NOW, before superdough mutates it
  setTimeout(() => flashChip(sound, durMs), delayMs);
}

// the mixer re-sets a filtered view of the last evaluated pattern — no
// re-eval, so slider values and the scheduler clock are untouched
let lastPattern = null;

function applyMixer() {
  if (!lastPattern?.onTrigger || !state.playing) return;
  let pat = lastPattern;
  if (soloed) pat = pat.filterValues((v) => soundKey(v) === soloed);
  else if (muted.size) pat = pat.filterValues((v) => !muted.has(soundKey(v)));
  getRepl().setPattern(pat.onTrigger(onTrig, false), true);
  invalidateHighlight(getRepl().scheduler); // highlight the filtered pattern
}

// --- track loading / hot reload ---
const trackUrl = (name) => `/tracks/${name.split('/').map(encodeURIComponent).join('/')}`;

async function fetchTrack(name) {
  const res = await fetch(trackUrl(name), { cache: 'no-store' });
  if (!res.ok) throw new Error(`failed to load ${name}`);
  return res.text();
}

async function evalCode(code) {
  try {
    clearError();
    beginSliderEval();
    const pat = await evaluate(code);
    endSliderEval(); // drop widgets whose slider() call disappeared
    if (!pat) return; // eval error — surfaced via onEvalError
    lastPattern = pat;
    applyMixer();
    setStatus(`playing ${state.track}`);
  } catch (e) {
    console.error(e);
    showError(e);
    setStatus(`eval error in ${state.track}`);
  }
}

async function selectTrack(name) {
  await flushSave(); // don't lose pending editor keystrokes on track switch
  state.track = name;
  el.trackname.textContent = `tracks/${name}`;
  renderTracklist();
  try {
    state.code = await fetchTrack(name);
    setCode(state.code);
    clearError();
    clearChips();
    clearSliders(); // sliders belong to a track — fresh strip per selection
    muted.clear(); // mixer state belongs to a track too
    soloed = null;
    lastPattern = null;
    if (state.playing) await evalCode(state.code);
  } catch (e) {
    showError(e);
  }
}

// --- in-browser editing -----------------------------------------------------
// The editor IS the file: keystrokes are debounce-saved to disk via
// PUT /tracks/<name>, then applied like any other change. External edits
// (your $EDITOR, Claude) still flow in through the watcher while you look on.
const SAVE_DEBOUNCE_MS = 600;
let saveTimer = null;

async function saveTrack() {
  if (!state.track || !state.dirty) return;
  const code = getCode();
  try {
    const res = await fetch(trackUrl(state.track), { method: 'PUT', body: code });
    if (!res.ok) throw new Error(`save failed: ${await res.text()}`);
    state.dirty = false;
    state.code = code;
    setStatus(`saved ${state.track}`);
    if (state.playing) await evalCode(code);
  } catch (e) {
    showError(e);
  }
}

function flushSave() {
  clearTimeout(saveTimer);
  return saveTrack();
}

createEditor(el.editor, {
  onChange: () => {
    if (!state.track) return;
    state.dirty = true;
    setStatus('…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveTrack, SAVE_DEBOUNCE_MS);
  },
  onEvaluate: () => flushSave(), // Ctrl/Alt+Enter — apply now, skip the debounce
  onStop: () => el.stop.click(), // Ctrl/Alt+.
});

// --- track CRUD --------------------------------------------------------------
const NEW_TRACK_TEMPLATE = `// new track
setcps(150/60/4) // 1 cycle = 1 bar

$: s("bd*4").bank("RolandTR909")
`;

const normalizeName = (raw) => {
  let name = (raw || '').trim().replace(/^\/+/, '');
  if (!name) return null;
  if (!name.endsWith('.strudel')) name += '.strudel';
  return name;
};

async function putTrack(name, code) {
  const res = await fetch(trackUrl(name), { method: 'PUT', body: code });
  if (!res.ok) throw new Error(`save failed: ${await res.text()}`);
}

async function removeTrack(name) {
  const res = await fetch(trackUrl(name), { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed: ${await res.text()}`);
}

async function createTrack(defaultName, code) {
  const name = normalizeName(prompt('track path (folders are created as needed):', defaultName));
  if (!name) return;
  if (state.tracks.includes(name) && !confirm(`${name} exists — overwrite?`)) return;
  try {
    await putTrack(name, code);
    await refreshList();
    await selectTrack(name);
  } catch (e) {
    showError(e);
  }
}

document.getElementById('tnew').addEventListener('click', () => {
  createTrack('originals/untitled.strudel', NEW_TRACK_TEMPLATE);
});

document.getElementById('tdup').addEventListener('click', () => {
  if (!state.track) return;
  createTrack(state.track.replace(/\.strudel$/, '-copy.strudel'), state.code);
});

document.getElementById('tren').addEventListener('click', async () => {
  if (!state.track) return;
  const name = normalizeName(prompt('rename / move to:', state.track));
  if (!name || name === state.track) return;
  try {
    await putTrack(name, state.code);
    await removeTrack(state.track);
    await refreshList();
    await selectTrack(name);
  } catch (e) {
    showError(e);
  }
});

document.getElementById('tdel').addEventListener('click', async () => {
  if (!state.track) return;
  if (!confirm(`delete tracks/${state.track}? (it's gone from disk — git is your undo)`)) return;
  try {
    await removeTrack(state.track);
    state.track = null;
    await refreshList(); // picks the first remaining track
  } catch (e) {
    showError(e);
  }
});

// hot reload: re-fetch the current track; on change, update the view and
// re-evaluate if playing — strudel swaps patterns at the next cycle boundary.
// Primary trigger is the tracks-changed websocket push from the vite plugin;
// the poll stays as a fallback (preview builds, dropped ws connections).
async function checkTrack() {
  if (!state.track) return;
  if (state.dirty) return; // our own write is in flight — don't clobber keystrokes
  try {
    const fresh = await fetchTrack(state.track);
    if (fresh !== state.code) {
      state.code = fresh;
      setCode(fresh); // external edit — merge into the editor, keep the caret
      setStatus(`reloaded ${state.track} @ ${new Date().toLocaleTimeString()}`);
      console.log(`[hot-reload] ${state.track} changed, re-evaluating: ${state.playing}`);
      if (state.playing) await evalCode(fresh);
    }
  } catch {
    /* transient fetch errors are fine — next poll retries */
  }
}
setInterval(checkTrack, TRACK_POLL_MS);

if (import.meta.hot) {
  import.meta.hot.on('tracks-changed', ({ file }) => {
    refreshList();
    if (file === state.track) checkTrack();
  });
}

// --- track list: a folder tree over the relative paths from /tracks ---
const collapsed = new Set();

function buildTree(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push(p);
  }
  return root;
}

function renderNode(node, container, prefix, depth) {
  for (const [dir, child] of [...node.dirs.entries()].sort()) {
    const dirPath = `${prefix}${dir}/`;
    const isClosed = collapsed.has(dirPath);
    const head = document.createElement('button');
    head.className = 'folder';
    head.style.paddingLeft = `${0.5 + depth * 0.8}rem`;
    head.textContent = `${isClosed ? '▸' : '▾'} ${dir}/`;
    head.addEventListener('click', () => {
      isClosed ? collapsed.delete(dirPath) : collapsed.add(dirPath);
      renderTracklist();
    });
    container.appendChild(head);
    if (!isClosed) renderNode(child, container, dirPath, depth + 1);
  }
  for (const file of node.files.sort()) {
    const btn = document.createElement('button');
    btn.className = 'file';
    btn.style.paddingLeft = `${0.5 + depth * 0.8}rem`;
    btn.textContent = `♪ ${file.split('/').pop().replace(/\.strudel$/, '')}`;
    btn.classList.toggle('active', file === state.track);
    btn.addEventListener('click', () => selectTrack(file));
    container.appendChild(btn);
  }
}

function renderTracklist() {
  el.tracklist.innerHTML = '';
  renderNode(buildTree(state.tracks), el.tracklist, '', 0);
}

async function refreshList() {
  try {
    const res = await fetch('/tracks', { cache: 'no-store' });
    const list = await res.json();
    if (JSON.stringify(list) !== JSON.stringify(state.tracks)) {
      state.tracks = list;
      renderTracklist();
    }
    if (!state.track && list.length) await selectTrack(list[0]);
  } catch {
    /* retry next poll */
  }
}
refreshList();
setInterval(refreshList, LIST_POLL_MS);

// --- transport ---
el.play.addEventListener('click', async () => {
  if (!state.ready || !state.track) return;
  await booted;
  // initAudioOnFirstClick only fires on a real mousedown — synthetic clicks
  // (agents, CI) would otherwise play without the worklet effects (coarse,
  // crush, shape). initAudio is idempotent, so calling it again is free.
  await initAudio();
  state.playing = true;
  el.play.classList.add('playing');
  await evalCode(state.code);
});

el.stop.addEventListener('click', () => {
  state.playing = false;
  el.play.classList.remove('playing');
  hush();
  clearChips();
  setStatus('stopped');
});

// --- export ---
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const trackSlug = () => (state.track || 'untitled').replace(/\.strudel$/, '').replace(/\//g, '_');

el.rec.addEventListener('click', () => {
  if (!isRecording()) {
    startRecording();
    el.rec.classList.add('recording');
    el.rec.textContent = '■ save wav';
    setStatus('recording… (what you hear is what you get)');
  } else {
    const blob = stopRecording();
    el.rec.classList.remove('recording');
    el.rec.textContent = '● rec';
    if (blob && blob.size > 44) {
      download(blob, `${trackSlug()}_${stamp()}.wav`);
      setStatus(`exported ${trackSlug()}.wav (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } else {
      setStatus('recording was empty');
    }
  }
});

el.dl.addEventListener('click', () => {
  if (!state.track) return;
  download(new Blob([state.code], { type: 'text/plain' }), state.track.split('/').pop());
});

// expose for debugging / driving from devtools
window.__player = { state, selectTrack, evalCode, saveTrack, getCode, setCode, getView, getRepl };
