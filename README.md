# strudel player

A local-first [Strudel](https://strudel.cc) live-coding environment where **the
file on disk is the source of truth** — designed so a human and an AI coding
agent can play music together.

Your tracks are plain `.strudel` files in a folder. Edit them in the browser,
in your `$EDITOR`, or let an agent like Claude Code write them — every change
hot-swaps into the running music at the next cycle boundary. No copy-pasting
into a web REPL, no state trapped in a browser tab.

```
┌───────────────┬─────────────────────────────────────────┐
│ ▶ ■ ● ⬇ ∿     │  [chips: bd cp hh bass — click to mute] │
├───────────────┼─────────────────────────────────────────┤
│ tracks/       │  s1 ──────●────── 1200    s2 ──●── 0.3  │
│  demo/        │ ─────────────────────────────────────── │
│   ♪ welcome   │  setcps(120/60/4)                       │
│   ♪ arrange…  │  const cutoff = slider(1200, 200, 4000) │
│               │  $: stack(                              │
│               │    s("bd*4").bank("RolandTR909"),       │
│               │    ...                  ← live highlight│
└───────────────┴─────────────────────────────────────────┘
```

## Quickstart

```bash
docker compose up -d        # player at http://localhost:5273
```

Open http://localhost:5273, pick a track, press ▶ once (browser audio policy),
then start editing — in the browser or in any editor on disk. That's the whole
workflow.

Without Docker: `cd web && npm install && npm run dev`.

## Features

- **Two-way editing** — a CodeMirror 6 editor (the same `@strudel/codemirror`
  strudel.cc uses) with syntax + live pattern highlighting; keystrokes
  debounce-save to disk, external edits flow back in instantly over websocket.
- **Hot reload as performance** — edit `tracks/**/*.strudel` while playing;
  Strudel swaps patterns at the next cycle boundary.
- **`slider()` macros** — strudel.cc-compatible live widgets; values survive
  hot reloads.
- **MIDI learn** — click a slider label, twist a hardware knob, bound. Bindings
  persist.
- **Chip mixer** — every sounding voice appears as a chip; click to mute,
  alt-click to solo. No re-eval.
- **Scope + spectrum** (∿ viz) and **WAV recording** (● rec) tapped from the
  master output — what you hear is what you get.
- **Track CRUD** — create/duplicate/rename/delete from the UI; folders become
  a sidebar tree.
- **Configurable sample packs** — `web/public/player.config.json`.
- **CI smoke test** — every track must eval clean (`web/test/smoke.mjs`).

## Live-coding with an AI agent

This player exists because file-on-disk-is-truth makes an AI a bandmate
instead of a code generator: the agent edits track files and verifies its own
work through the browser, while you listen and direct.

- `.claude/skills/` ships three player-specific skills for
  [Claude Code](https://claude.com/claude-code): **strudel-player-api**
  (driving/verifying the player), **strudel-player-compose** (track-file
  conventions + the gotchas that bite), **strudel-player-conduct** (live
  changes while a human listens).
- For the actual *musicianship* — genres, basslines, arrangement, mixing,
  harmony, transitions and more — we use the excellent open-source Strudel
  skill rack from
  [vanities/toaster-strudel](https://github.com/vanities/toaster-strudel)
  (GPL-3.0). Drop its `strudel-*` skills next to ours and an agent can take a
  brief like "write me a 140 BPM garage track" to a finished arrangement.

## Sample policy

This repo contains **no audio files**. Demo tracks use the public Strudel
sample packs (loaded from the network at boot, see `player.config.json`) and
synths/soundfonts. Keep it that way in forks you publish: samples you ripped
or licensed don't belong in a public git history.

## License

[AGPL-3.0](LICENSE). The engine wiring in `web/src/strudel.js` is adapted from
[@strudel/web](https://github.com/tidalcycles/strudel) (AGPL-3.0); this project
inherits the license, gladly. Strudel itself is by Felix Roos & the
[TidalCycles](https://strudel.cc) community — all the magic is theirs, this is
a player around it.
