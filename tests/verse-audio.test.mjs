import assert from "node:assert/strict";
import test from "node:test";
import { encodeWav, joinSamples, peakNormalize, trimSilence } from "../site/static/verse-audio.js";
import { logMel, melFilters } from "../site/static/neural-resynth.js";

test("clips are trimmed, normalised and joined with a short gap", () => {
  const clip = new Float32Array([0, 0, 0.1, -0.2, 0, 0]);
  const trimmed = trimSilence(clip, 10);
  assert.equal(trimmed.length, 2);
  assert.equal(Math.max(...peakNormalize(trimmed).map(Math.abs)).toFixed(2), "0.80");
  assert.equal(joinSamples([clip, clip], 1000).length, clip.length * 2 + 80);
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
