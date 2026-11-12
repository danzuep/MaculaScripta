// Neural audio resynthesis: a HiFi-GAN vocoder (ONNX Runtime Web, WebAssembly) rebuilds a joined verse from its mel
// spectrogram, which smooths the joins between separately recorded words. The runtime and model are downloaded the
// first time they are needed and kept by the service worker. The mel features follow SpeechT5's front end (16 kHz,
// 80 bands, 1024-sample window, 256 hop, 80-7600 Hz) that Xenova/speecht5_hifigan was trained with.
const runtimeBase = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const modelUrl = "https://huggingface.co/Xenova/speecht5_hifigan/resolve/main/onnx/model.onnx";

export const resynthRate = 16000;
const fftSize = 1024;
const hop = 256;
const bands = 80;
const minHz = 80;
const maxHz = 7600;

const hzToMel = (hz) => hz < 1000 ? hz * 3 / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27);
const melToHz = (mel) => mel < 15 ? mel * 200 / 3 : 1000 * Math.exp((mel - 15) * Math.log(6.4) / 27);

// Slaney-scale, slaney-normalised triangular filters: bands rows of fftSize / 2 + 1 weights.
export function melFilters(rate = resynthRate) {
  const bins = fftSize / 2 + 1;
  const points = Array.from({ length: bands + 2 }, (_, index) => melToHz(hzToMel(minHz) + (hzToMel(maxHz) - hzToMel(minHz)) * index / (bands + 1)));
  return Array.from({ length: bands }, (_, band) => {
    const [low, centre, high] = points.slice(band, band + 3);
    const weights = new Float32Array(bins);
    for (let bin = 0; bin < bins; bin += 1) {
      const hz = bin * rate / fftSize;
      weights[bin] = Math.max(0, Math.min((hz - low) / (centre - low), (high - hz) / (high - centre))) * 2 / (high - low);
    }
    return weights;
  });
}

// In-place radix-2 FFT.
function fft(real, imaginary) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < length / 2; k += 1) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + length / 2;
        const re = real[b] * cos - imaginary[b] * sin;
        const im = real[b] * sin + imaginary[b] * cos;
        real[b] = real[a] - re;
        imaginary[b] = imaginary[a] - im;
        real[a] += re;
        imaginary[a] += im;
      }
    }
  }
}

// Log10 mel spectrogram as a flat Float32Array of frames x bands values.
export function logMel(samples) {
  const filters = melFilters();
  const window = Float32Array.from({ length: fftSize }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / fftSize));
  const padded = new Float32Array(samples.length + fftSize);
  padded.set(samples, fftSize / 2);
  for (let i = 1; i <= fftSize / 2; i += 1) {
    padded[fftSize / 2 - i] = samples[Math.min(i, samples.length - 1)] ?? 0;
    padded[fftSize / 2 + samples.length - 1 + i] = samples[Math.max(samples.length - 1 - i, 0)] ?? 0;
  }
  const frames = 1 + Math.floor(samples.length / hop);
  const mel = new Float32Array(frames * bands);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const magnitude = new Float64Array(fftSize / 2 + 1);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let i = 0; i < fftSize; i += 1) real[i] = (padded[frame * hop + i] ?? 0) * window[i];
    imaginary.fill(0);
    fft(real, imaginary);
    for (let bin = 0; bin < magnitude.length; bin += 1) magnitude[bin] = Math.hypot(real[bin], imaginary[bin]);
    for (let band = 0; band < bands; band += 1) {
      let sum = 0;
      for (let bin = 0; bin < magnitude.length; bin += 1) sum += filters[band][bin] * magnitude[bin];
      mel[frame * bands + band] = Math.log10(Math.max(sum, 1e-10));
    }
  }
  return { mel, frames };
}

let sessionPromise;

function loadSession() {
  sessionPromise ??= (async () => {
    const ort = await import(`${runtimeBase}ort.min.mjs`);
    ort.env.wasm.wasmPaths = runtimeBase;
    ort.env.wasm.numThreads = 1;
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status})`);
    return { ort, session: await ort.InferenceSession.create(new Uint8Array(await response.arrayBuffer()), { executionProviders: ["wasm"] }) };
  })().catch((error) => {
    sessionPromise = undefined;
    throw error;
  });
  return sessionPromise;
}

// Resynthesises 16 kHz mono samples. Resolves to null when the runtime or model is unavailable, so callers can play
// the original audio instead.
export async function resynthesize(samples) {
  try {
    const { ort, session } = await loadSession();
    const { mel, frames } = logMel(samples);
    const output = await session.run({ spectrogram: new ort.Tensor("float32", mel, [1, frames, bands]) });
    const waveform = Object.values(output)[0].data;
    return waveform.length ? Float32Array.from(waveform) : null;
  } catch (error) {
    console.warn("Neural resynthesis is unavailable", error);
    return null;
  }
}
