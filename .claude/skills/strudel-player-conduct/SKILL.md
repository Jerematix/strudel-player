---
name: strudel-player-conduct
description: Live-performing with the player while a human listens — editing tracks mid-playback, using sliders, the chip mixer, and safe-change discipline. Use when the user is listening and asks for live changes.
---

# Conducting: live changes while the human listens

Editing the playing track's file IS the performance. Saves apply at the next
cycle boundary, so changes land musically — but an eval error mid-set means
silence-on-stage. Discipline:

## Safe-change workflow

1. **One musical idea per edit.** Save, let it swap in, listen for the user's
   reaction before the next move.
2. **Read the error panel after every save** (`#error` in the player, or the
   eval-error status). If you broke it, the old pattern keeps playing — fix
   forward or revert immediately; don't pile a second edit on a broken state.
3. **Big restructures off-line**: duplicate the track (the ⧉ dup button or
   `PUT` to a new path), rework the copy, A/B by switching tracks.

## The live surface (cheaper than edits)

- **Sliders** — macros the track exposes (`slider()` calls). Dragging needs no
  re-eval and reacts within the scheduler lookahead. Prefer riding an existing
  `energy`/filter slider over editing gain values.
- **Chip mixer** — every sounding voice shows as a chip in the header. Click
  = mute that voice, alt-click = solo. No re-eval, sliders untouched. Great
  for "drop the drums for 8 bars" requests.
- **MIDI** — the human can bind hardware knobs to sliders (click label, twist
  knob). Don't fight their hands: if they're riding a slider, change other
  things.

## Musical edit patterns

- Mute/unmute a voice in code by commenting its line inside the `stack()` —
  the classic live-coding arrangement move.
- Energy down: `.lpf(800)` on the bass, drop a hat line, halve a `fast()`.
- Energy up: add a ride/hat layer, open a filter, add `.ply(2)` to one voice.
- Transition trick: wrap a section change at a save so the cycle-boundary swap
  IS the transition.

## Recording

The ● rec button taps the master output — what the human hears is what lands
in the WAV. Start recording before a take, stop after the outro; the file
downloads with track name + timestamp.
