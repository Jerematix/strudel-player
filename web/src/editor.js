// CodeMirror 6 editor wired the same way strudel.cc's REPL does it, but
// against OUR repl (strudel.js) instead of StrudelMirror's internal one:
//  - initEditor() from @strudel/codemirror brings the strudel theme, JS syntax
//    highlighting and the mini-notation highlight extension
//  - after each eval, the transpiler's meta.miniLocations are pushed in via
//    updateMiniLocations(); a @strudel/draw Drawer then calls
//    highlightMiniLocations() every frame with the haps active right now
// The document is always editable; main.js debounce-saves changes to disk.

import {
  initEditor,
  codemirrorSettings,
  defaultSettings,
  updateMiniLocations,
  highlightMiniLocations,
} from '@strudel/codemirror';
import { Drawer } from '@strudel/draw';

let view = null;
let drawer = null;
let applyingRemote = false; // suppress the change callback for disk → editor updates

export function createEditor(root, { onChange, onEvaluate, onStop }) {
  codemirrorSettings.set({
    ...defaultSettings,
    ...codemirrorSettings.get(),
    isPatternHighlightingEnabled: true,
    isTabIndentationEnabled: true,
    isLineNumbersDisplayed: true,
  });
  view = initEditor({
    root,
    initialCode: '',
    onChange: (v) => {
      if (v.docChanged && !applyingRemote) onChange(v.state.doc.toString());
    },
    onEvaluate,
    onStop,
  });
  drawer = new Drawer((haps, time) => {
    highlightMiniLocations(
      view,
      time,
      haps.filter((h) => h.isActive(time)),
    );
  }, [0, 0]);
  return view;
}

export const getCode = () => view?.state.doc.toString() ?? '';
export const getView = () => view;

// disk → editor (track switch, external edit): replace the doc, keep the caret
export function setCode(code) {
  if (!view || code === getCode()) return;
  applyingRemote = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: code },
    selection: { anchor: Math.min(view.state.selection.main.head, code.length) },
  });
  applyingRemote = false;
}

export function setMiniLocations(locations) {
  view && updateMiniLocations(view, locations || []);
}

export function startHighlight(scheduler) {
  drawer?.start(scheduler);
}

export function stopHighlight() {
  drawer?.stop();
  view && updateMiniLocations(view, []);
}

// call after every setPattern/eval so the drawer re-queries the new pattern
export function invalidateHighlight(scheduler) {
  drawer?.invalidate(scheduler);
}
