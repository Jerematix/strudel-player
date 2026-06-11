---
name: strudel-player-api
description: How an agent drives and verifies the strudel player — HTTP endpoints, window.__player, hot reload mechanics, and the headless smoke test. Use when testing tracks, debugging eval errors, or automating the player.
---

# Driving the player as an agent

The player at `http://localhost:5273` is built so that **the file on disk is the
single source of truth**. You never need to type into the browser to change the
music — write the `.strudel` file and the player follows.

## HTTP API (vite middleware, `web/vite.config.js`)

| Endpoint | Effect |
|---|---|
| `GET /tracks` | JSON list of all track paths, recursive |
| `GET /tracks/<path>` | raw track source, `no-store` |
| `PUT /tracks/<path>` | write body to disk (creates folders; powers the in-browser editor) |
| `DELETE /tracks/<path>` | delete the file |

Only `*.strudel` paths under `tracks/` are accepted; traversal is rejected.

## Hot reload

A file change is pushed to the browser over Vite's HMR websocket (instant); a
700 ms poll is the fallback. If the track is playing, the player re-`evaluate()`s
and Strudel swaps patterns **at the next cycle boundary** — editing the file
while the user listens is the intended live workflow.

While the in-browser editor has unsaved keystrokes (debounced 600 ms), external
changes are NOT applied — your write lands on disk and wins after their save.

## window.__player (drive it via browser automation / chrome-devtools MCP)

```js
const p = window.__player;
p.state          // { ready, playing, track, code, tracks, dirty }
p.selectTrack('demo/welcome.strudel')  // switch track (await it)
p.evalCode(p.state.code)               // force evaluation (await it)
p.getCode() / p.setCode(src)           // editor document (setCode = "remote" path, no save)
p.getView()                            // the CodeMirror EditorView
p.getRepl().scheduler                  // scheduler: .now(), .pattern.queryArc(a, b)
```

Selecting a track does **not** auto-evaluate unless `state.playing` is true.
`#play` and `#stop` are separate buttons (play does not toggle).

## Verifying a track

1. `await p.selectTrack(name)`, `await p.evalCode(p.state.code)`, wait ~500 ms.
2. `document.getElementById('error')` — `hidden === true` means the eval is clean.
3. `Object.keys(window.soundMap.get())` lists every registered sound — check a
   sample name is actually loaded before blaming the pattern.
4. Musical inspection without audio: `p.getRepl().scheduler.pattern.queryArc(t, t+1)`
   returns the haps of one cycle — assert voices, counts, values.
5. You cannot hear. The human is the final judge of musicality.

Headless run over every track: `node web/test/smoke.mjs` (used by CI). It
needs the dev server running and `puppeteer` (or `puppeteer-core` + system
Chrome) installed.

## Gotchas

- The first ▶ click must come from the human (browser audio policy). Synthetic
  clicks work after that; `initAudio()` is called on play so worklet effects
  (`coarse`, `crush`, `shape`) load even for scripted presses.
- Sample packs come from `web/public/player.config.json`; a missing pack fails
  soft (console warning, sounds silently absent).
- Slider values survive hot reloads (matched by call order). Editing a
  slider's default/min/max in code resets that widget.
