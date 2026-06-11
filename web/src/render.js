// Offline (faster-than-realtime where the browser allows) track renderer.
//
// We do NOT use @strudel/webaudio's renderPatternAudio: it closes the live
// audio context and builds the ENTIRE song's audio graph in one
// OfflineAudioContext before rendering — on full tracks that is a memory bomb
// (tab crash), and superdough's context-blind node pool silently kills voices
// (see the nodePoolKey guard in strudel.js).
//
// Chunks render SEQUENTIALLY and SMALL, on purpose. Measured in Chrome (2026-06):
//  - OfflineAudioContexts containing AudioWorkletNodes (superdough always
//    has some) are serialized onto ONE offline rendering thread — concurrent
//    renders give 1.00x speedup and triple per-chunk times via contention;
//    audioWorklet.addModule() on a new context blocks behind in-flight
//    renders, so pipelining gains nothing either. (No OfflineAudioContext in
//    workers in this Chrome, so worker parallelism is out too.)
//  - Render cost is SUPERLINEAR in chunk length (finished voices keep
//    burdening the graph until their delayed release fires): the same dense
//    16 cycles rendered in 38.3s as one chunk, 4.7s as 4-cycle chunks,
//    1.9s as 2-cycle chunks. Small chunks ARE the speedup: ~8-14x realtime.
//
// Chunks get a tail so reverb/delay rings past the boundary, and are
// overlap-added into one master buffer. Seam caveats (every chunkCycles
// bars): per-orbit delay feedback restarts, and a `cut` group can't choke a
// voice from the previous chunk (its tail rings out via the overlap instead).
// 4-cycle chunks align seams with musical phrases, which keeps this inaudible
// in practice; bump chunkCycles if a track audibly smears at seams.

import {
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
  initAudio,
} from '@strudel/webaudio';

export async function renderOffline(pat, cps, cycles, opts = {}) {
  const { chunkCycles = 4, tailSeconds = 6, sampleRate = 44100, onProgress } = opts;
  const totalFrames = Math.ceil((cycles / cps + tailSeconds) * sampleRate);
  const outL = new Float32Array(totalFrames);
  const outR = new Float32Array(totalFrames);
  const failures = new Map(); // "sound: error" -> count
  let scheduled = 0;

  const totalChunks = Math.ceil(cycles / chunkCycles);
  let doneChunks = 0;

  try {
    for (let c0 = 0; c0 < cycles; c0 += chunkCycles) {
      const c1 = Math.min(c0 + chunkCycles, cycles);
      const tBuild = performance.now();
      const haps = pat
        .queryArc(c0, c1, { _cps: cps })
        .filter((h) => h.hasOnset())
        .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());

      const chunkFrames = Math.ceil(((c1 - c0) / cps + tailSeconds) * sampleRate);
      const ctx = new OfflineAudioContext(2, chunkFrames, sampleRate);
      // swap the global context so every superdough node lands in this chunk
      setAudioContext(ctx);
      setSuperdoughAudioController(null); // lazy-rebuild orbits/effects on ctx
      await initAudio({});

      for (const h of haps) {
        h.ensureObjectValue();
        const t = (h.whole.begin.valueOf() - c0) / cps;
        try {
          await superdough(h.value, t, h.duration / cps, cps, t);
          scheduled++;
        } catch (e) {
          const key = `${h.value?.s ?? '?'}: ${String(e?.message || e).slice(0, 90)}`;
          failures.set(key, (failures.get(key) || 0) + 1);
        }
      }
      const buildMs = Math.round(performance.now() - tBuild);

      const tRender = performance.now();
      const buf = await ctx.startRendering();
      console.log(
        `[render] chunk ${c0}–${c1}: ${haps.length} haps, build ${buildMs}ms, render ${Math.round(performance.now() - tRender)}ms`,
      );

      const off = Math.round((c0 / cps) * sampleRate);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      for (let i = 0; i < L.length && off + i < totalFrames; i++) {
        outL[off + i] += L[i];
        outR[off + i] += R[i];
      }
      doneChunks++;
      onProgress?.(doneChunks / totalChunks);
    }
  } finally {
    // drop the offline globals — the next live use lazily creates a fresh
    // context (the player's getTap/getTime/analyser all re-resolve per use)
    setAudioContext(null);
    setSuperdoughAudioController(null);
  }

  let peak = 0;
  for (let i = 0; i < totalFrames; i++) {
    const a = Math.abs(outL[i]);
    const b = Math.abs(outR[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  // no master limiter offline — normalize hot renders instead of clipping
  if (peak > 0.99) {
    const k = 0.95 / peak;
    for (let i = 0; i < totalFrames; i++) {
      outL[i] *= k;
      outR[i] *= k;
    }
  }
  return { left: outL, right: outR, sampleRate, peak, scheduled, failures };
}
