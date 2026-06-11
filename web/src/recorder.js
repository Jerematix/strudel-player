// Realtime WAV recorder. Taps the master output (see strudel.js getTap),
// collects float PCM via a ScriptProcessor, encodes 16-bit stereo WAV on stop.
// What you hear is what you get — recording happens in real time.

import { getAudioContext, getTap, excludeFromTap } from './strudel.js';

let proc = null;
let chunksL = [];
let chunksR = [];
let recording = false;

export const isRecording = () => recording;

export function startRecording() {
  if (recording) return;
  const ctx = getAudioContext();
  const tap = getTap();
  chunksL = [];
  chunksR = [];
  proc = ctx.createScriptProcessor(4096, 2, 2);
  excludeFromTap(proc); // ScriptProcessors must reach destination to tick; don't mirror it back into the tap
  proc.onaudioprocess = (e) => {
    chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    // output buffer stays silent — the processor is capture-only
  };
  tap.connect(proc);
  proc.connect(ctx.destination);
  recording = true;
}

export function stopRecording() {
  if (!recording) return null;
  recording = false;
  const ctx = getAudioContext();
  getTap().disconnect(proc);
  proc.disconnect();
  proc.onaudioprocess = null;
  proc = null;
  const blob = encodeWav(chunksL, chunksR, ctx.sampleRate);
  chunksL = [];
  chunksR = [];
  return blob;
}

export function encodeWav(chunksL, chunksR, sampleRate) {
  const len = chunksL.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + len * 4);
  const view = new DataView(buffer);
  const writeStr = (off, s) => [...s].forEach((ch, i) => view.setUint8(off + i, ch.charCodeAt(0)));

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // byte rate
  view.setUint16(32, 4, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, len * 4, true);

  let off = 44;
  for (let c = 0; c < chunksL.length; c++) {
    const L = chunksL[c];
    const R = chunksR[c];
    for (let i = 0; i < L.length; i++) {
      view.setInt16(off, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true);
      view.setInt16(off + 2, Math.max(-1, Math.min(1, R[i])) * 0x7fff, true);
      off += 4;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
