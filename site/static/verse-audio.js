// Verse audio assembly: joins word clips into one signal, encodes it as WAV, and compresses it for download.
// The sample maths is pure (Float32Array in, Float32Array out); decoding and compression use the browser's Web Audio.

export const verseSampleRate = 16000;
const overlapSeconds = 0.03;

// Scales to a common loudness so words recorded at different levels (and computer-voice words) sit together.
export function rmsNormalize(samples, target = 0.12) {
  let sum = 0;
  for (const value of samples) sum += value * value;
  const rms = Math.sqrt(sum / (samples.length || 1));
  if (!rms) return samples;
  const gain = Math.min(target / rms, 8);
  return samples.map((value) => Math.max(-1, Math.min(1, value * gain)));
}

export function peakNormalize(samples, target = 0.8) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (!peak) return samples;
  const gain = target / peak;
  return samples.map((value) => value * gain);
}

// Drops leading and trailing samples quieter than `threshold` (relative to the peak), keeping a short margin.
export function trimSilence(samples, rate = verseSampleRate, threshold = 0.02) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const limit = peak * threshold;
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) <= limit) start += 1;
  while (end > start && Math.abs(samples[end - 1]) <= limit) end -= 1;
  const margin = Math.round(rate * 0.04);
  return samples.slice(Math.max(0, start - margin), Math.min(samples.length, end + margin));
}

// Joins words with an equal-power crossfade over their (already quiet) edges, so there are no clicks or abrupt cuts.
export function joinSamples(parts, rate = verseSampleRate) {
  const overlap = Math.round(rate * overlapSeconds);
  const lengths = parts.map((part) => part.length);
  const fade = (index) => Math.min(overlap, Math.floor(lengths[index] / 2), Math.floor(lengths[index + 1] / 2));
  const total = lengths.reduce((sum, length) => sum + length, 0) - lengths.slice(1).reduce((sum, _, index) => sum + fade(index), 0);
  const joined = new Float32Array(total);
  let offset = 0;
  parts.forEach((part, index) => {
    const into = index > 0 ? fade(index - 1) : 0;
    const out = index < parts.length - 1 ? fade(index) : 0;
    for (let i = 0; i < part.length; i += 1) {
      let gain = 1;
      if (i < into) gain = Math.sin(Math.PI / 2 * i / into);
      else if (i >= part.length - out) gain = Math.cos(Math.PI / 2 * (i - (part.length - out)) / out);
      joined[offset + i] += part[i] * gain;
    }
    offset += part.length - out;
  });
  return joined;
}

// Mixes the neural output into the original: `wet` is the neural share. Both are peak-normalised first.
export function blendSamples(dry, wet, mix) {
  const length = Math.min(dry.length, wet.length);
  const a = peakNormalize(dry);
  const b = peakNormalize(wet);
  return Float32Array.from({ length }, (_, i) => a[i] * (1 - mix) + b[i] * mix);
}

export function encodeWav(samples, rate = verseSampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true));
  return new Blob([view], { type: "audio/wav" });
}

// Decodes any browser-playable clip to mono samples at `verseSampleRate`.
export async function decodeBlob(blob) {
  const context = new AudioContext({ sampleRate: verseSampleRate });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return buffer.getChannelData(0).slice();
  } finally {
    context.close();
  }
}

const compressedTypes = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

// Compresses samples with the browser's own encoder by playing them into a MediaRecorder (takes as long as the audio).
// Browsers without a supported encoder get the uncompressed WAV instead.
export async function compressSamples(samples, rate = verseSampleRate) {
  const type = globalThis.MediaRecorder && compressedTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!type) return encodeWav(samples, rate);
  const context = new AudioContext({ sampleRate: rate });
  try {
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const destination = context.createMediaStreamDestination();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    const recorder = new MediaRecorder(destination.stream, { mimeType: type, audioBitsPerSecond: 48000 });
    const pieces = [];
    recorder.ondataavailable = (event) => { if (event.data.size) pieces.push(event.data); };
    const finished = new Promise((resolve) => { recorder.onstop = resolve; });
    source.onended = () => recorder.stop();
    recorder.start();
    source.start();
    await finished;
    return new Blob(pieces, { type: recorder.mimeType || type });
  } finally {
    context.close();
  }
}

export const extensionForType = (type) => ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" })[type.split(";")[0]] ?? "bin";
