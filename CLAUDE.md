# strudel player — live-coding music workspace

A Dockerized Strudel player with hot reload, plus the tracks it plays.

## Run it

```bash
docker compose up -d        # player at http://localhost:5273
docker logs strudel-player  # vite output
docker compose exec player npm install   # after changing web/package.json
```

Audio plays in the host browser (user presses ▶ once). Docker only serves files.

## How to work here

Read the skills in `.claude/skills/` before touching tracks:

- **strudel-player-api** — endpoints, `window.__player`, verification workflow
- **strudel-player-compose** — track file conventions + parser gotchas
- **strudel-player-conduct** — live edits while the user listens

The one-paragraph version: tracks are self-contained `.strudel` files under
`tracks/` (`setcps` → const voices → const sections → `$: arrange(...)`).
Editing a file while the user listens hot-swaps at the next cycle boundary —
that IS the live workflow. Verify every edit through the player (`#error`
hidden, voices present in `queryArc`); you can't hear, the user judges
musicality.

## Layout

- `tracks/**/*.strudel` — the songs; folders render as a sidebar tree
- `web/` — Vite player. `src/strudel.js` = engine wiring (vendored from
  @strudel/web with `registerSoundfonts()` — do NOT switch to the prebuilt
  `@strudel/web` bundle: it duplicates the sound registry and `gm_*` voices
  silently vanish). `src/main.js` = UI/state. `src/editor.js` = CodeMirror.
  `src/sliders.js` + `src/midi.js` = slider widgets + MIDI learn.
  `src/recorder.js` + `src/viz.js` = master-tap WAV export + scope.
- `web/vite.config.js` — tracks API (GET/PUT/DELETE) + websocket push
- `web/public/player.config.json` — sample packs loaded at boot
- `web/test/smoke.mjs` — headless eval of every track (CI runs this)

## Policy

No audio files in the repo — demo tracks load public packs from the network.
License is AGPL-3.0.
