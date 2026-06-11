// Offline (faster-than-realtime) track renderer.
//
// We do NOT use @strudel/webaudio's renderPatternAudio: it closes the live
// audio context and builds the ENTIRE song's audio graph in one
// OfflineAudioContext before rendering — on full tracks that is a memory bomb
// (tab crash), and in our testing it intermittently mis-homes effect sends
// across contexts, producing silent files.
//
// Instead we render in chunks: each chunk gets a FRESH OfflineAudioContext
// (+ tail so reverb/delay rings past the boundary), haps are scheduled with
// superdough directly, and chunks are overlap-added into one master buffer.
// Per-voice errors are collected instead of swallowed, and the caller gets
// the final peak so a silent render can be rejected instead of downloaded.
//
// Known seam caveat: per-orbit feedback (delay regen) restarts at chunk
// boundaries. With the default 16-cycle chunks + 6s tails this is inaudible
// in practice.

import {
  getAudioContext,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
  initAudio,
} from '@strudel/webaudio';

export async function renderOffline(pat, cps, cycles, opts = {}) {
  const { chunkCycles = 16, tailSeconds = 6, sampleRate = 44100, onProgress } = opts;
  const totalFrames = Math.ceil((cycles / cps + tailSeconds) * sampleRate);
  const outL = new Float32Array(totalFrames);
  const outR = new Float32Array(totalFrames);
  const failures = new Map(); // "sound: error" -> count
  let scheduled = 0;

  try {
    for (let c0 = 0; c0 < cycles; c0 += chunkCycles) {
      const c1 = Math.min(c0 + chunkCycles, cycles);
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

      const buf = await ctx.startRendering();
      const off = Math.round((c0 / cps) * sampleRate);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      for (let i = 0; i < L.length && off + i < totalFrames; i++) {
        outL[off + i] += L[i];
        outR[off + i] += R[i];
      }
      onProgress?.(c1 / cycles);
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
