import assert from "node:assert/strict";
import test from "node:test";
import { blendSamples, encodeWav, joinSamples, peakNormalize, rmsNormalize, trimSilence } from "../site/static/verse-audio.js";
import { logMel, melFilters } from "../site/static/neural-resynth.js";

test("clips are trimmed, normalised and joined with a short gap", () => {
  const clip = new Float32Array([0, 0, 0.1, -0.2, 0, 0]);
  const trimmed = trimSilence(clip, 10);
  assert.equal(trimmed.length, 2);
  assert.equal(Math.max(...peakNormalize(trimmed).map(Math.abs)).toFixed(2), "0.80");
});

test("words are crossfaded without clicks and neural output is blended in", () => {
  const word = new Float32Array(1000).fill(0.5);
  const joined = joinSamples([word, word], 1000);
  assert.equal(joined.length, 2000 - 30);
  assert.ok(joined.slice(900, 1100).every((value) => Math.abs(value - 0.5) < 0.1 || value > 0.4));
  assert.equal(rmsNormalize(new Float32Array(100).fill(0.06))[0].toFixed(2), "0.12");
  assert.deepEqual([...blendSamples(Float32Array.of(1, 1), Float32Array.of(0, 0), 0.25)], [0.6000000238418579, 0.6000000238418579]);
});

test("WAV encoding writes a 16-bit mono header", async () => {
  const bytes = new Uint8Array(await encodeWav(new Float32Array([0, 1, -1]), 16000).arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(bytes.length, 44 + 6);
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16000);
});

test("the mel front end puts a 1 kHz tone in the matching band", () => {
  const tone = Float32Array.from({ length: 4096 }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / 16000));
  const { mel, frames } = logMel(tone);
  assert.equal(frames, 17);
  const band = mel.slice(8 * 80, 9 * 80);
  const peak = band.indexOf(Math.max(...band));
  const filters = melFilters();
  const bin = filters[peak].indexOf(Math.max(...filters[peak]));
  assert.ok(Math.abs(bin * 16000 / 1024 - 1000) < 150);
});
