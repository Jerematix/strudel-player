---
name: strudel-player-compose
description: Conventions and gotchas for writing .strudel track files for the strudel player — file structure, arrange() local clocks, sliders, sample banks, and the mini-notation traps. Use when composing or editing tracks.
---

# Writing tracks for the player

One file = one self-contained song. The shape that works:

```
setcps(BPM/60/4)            // 1 cycle = 1 bar
const macro = slider(...)   // live performance macros (optional)
const voiceA = s("...")     // named voices
const voiceB = note("...")
const sectionA = stack(voiceA, voiceB)   // sections combine voices
$: arrange([8, sectionA], [16, sectionB], ...)  // the song
```

Subfolders under `tracks/` render as a folder tree in the sidebar.

## The arrange() local-clock fact (load-bearing)

Inside `arrange()`, **every section starts at cycle 0 on its own clock**.
Consequences:

- `saw.range(a, b).slow(N)` with `N` = the section's cycle count ramps exactly
  once across the section, starting at its first bar.
- A stepped pattern `"<a b c d>"` walks from step 0 at the section boundary.
- Size ramps to the section, never to the whole song.

## Rules that bite (each one costs an hour when unknown)

- **Drum samples need `.bank("...")`** — bare `s("bd")` is silent. Banks come
  from the tidal-drum-machines pack: `RolandTR909`, `RolandTR808`, etc.
- **Chord stacks inside `<>` break the mini-notation parser.** Stack
  single-note lines instead:
  `stack(note("<a3 f3>"), note("<c4 c4>"), note("<e4 d4>"))`.
- `slider(value, min, max, step?)` renders a live widget and returns a
  continuous signal pattern. Values survive hot reloads (matched by call
  order); editing a slider's default/min/max resets it. Works exactly like
  strudel.cc's slider.
- Remote samples: `await samples({name: 'https://...'})` at the top of the
  file. **Always wrap in try/catch with a synth fallback** — network is not
  part of the groove:
  ```js
  let hasVox = true
  try { await samples({vox: 'https://...wav'}) } catch (e) { hasVox = false }
  const vox = (v) => hasVox ? v : silence
  ```
- `gm_*` sounds (128 General MIDI voices) come from soundfonts and are
  registered at boot — `note("c4").s("gm_epiano1")` just works.
- Check what's loaded: `Object.keys(window.soundMap.get())` in the browser.

## Verify before declaring done

Eval the track through the player (see strudel-player-api): the `#error`
panel must stay hidden, and `scheduler.pattern.queryArc(t, t+1)` should show
the voices you wrote. You can't hear — the human signs off on musicality.
