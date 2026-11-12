// Computer-voice readings of Greek words for any word that has no recording. Uses eSpeak-NG compiled to WebAssembly
// (Ancient Greek "grc" voice), downloaded from a CDN the first time it is needed and kept by the service worker.
const runtime = "https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.js";
const cache = new Map();
let factory;

// Resolves to a WAV Blob, or null when the speech engine cannot be loaded or produces nothing.
export async function synthesizeGreek(text) {
  if (cache.has(text)) return cache.get(text);
  const pending = (async () => {
    try {
      factory ??= import(runtime).then((module) => module.default);
      const engine = await (await factory)({ arguments: ["-v", "grc", "-s", "130", "-w", "reading.wav", text] });
      const wav = engine.FS.readFile("reading.wav");
      return wav.length > 44 ? new Blob([wav], { type: "audio/wav" }) : null;
    } catch (error) {
      console.warn("Greek speech synthesis is unavailable", error);
      factory = undefined;
      return null;
    }
  })();
  cache.set(text, pending);
  const blob = await pending;
  if (!blob) cache.delete(text);
  return blob;
}
