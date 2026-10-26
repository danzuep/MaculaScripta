const databaseName = "macula-linguistic-recorder";
const storeName = "dictionary";
const minimumTrimRatio = 0.02;
const ipaSymbols = [
  "ʔ", "ʕ", "ɬ", "ʃ", "θ", "ð", "χ", "ʁ", "ħ", "ŋ", "ts", "tʃ",
  "ɑ", "ɛ", "ɔ", "ə", "ɪ", "ʊ", "eː", "aː", "iː", "uː", "oː",
  "ˈ", "ˌ", "ˑ", "ː", "̃", "́", "̀"
];

const ui = {
  openButton: document.querySelector("#open-recorder"),
  dialog: document.querySelector("#recorder-dialog"),
  closeButton: document.querySelector("#close-recorder"),
  captureTab: document.querySelector("#recorder-tab-capture"),
  dictionaryTab: document.querySelector("#recorder-tab-dictionary"),
  captureView: document.querySelector("#recorder-capture"),
  dictionaryView: document.querySelector("#recorder-dictionary"),
  count: document.querySelector("#recorder-count"),
  status: document.querySelector("#recorder-status"),
  canvas: document.querySelector("#recorder-waveform"),
  placeholder: document.querySelector("#waveform-placeholder"),
  trimReadout: document.querySelector("#trim-readout"),
  trimStart: document.querySelector("#trim-start-time"),
  trimDuration: document.querySelector("#trim-duration"),
  trimEnd: document.querySelector("#trim-end-time"),
  recordButton: document.querySelector("#record-audio"),
  clearButton: document.querySelector("#clear-recording"),
  playButton: document.querySelector("#play-trim"),
  form: document.querySelector("#recorder-entry-form"),
  lemma: document.querySelector("#recorder-lemma"),
  ipa: document.querySelector("#recorder-ipa"),
  gloss: document.querySelector("#recorder-gloss"),
  syntax: document.querySelector("#recorder-syntax"),
  reference: document.querySelector("#recorder-ref"),
  morphology: document.querySelector("#recorder-morph"),
  ipaToggle: document.querySelector("#toggle-recorder-ipa"),
  ipaKeyboard: document.querySelector("#recorder-ipa-symbols"),
  search: document.querySelector("#recorder-search"),
  entries: document.querySelector("#recorder-entries"),
  empty: document.querySelector("#recorder-empty"),
  exportButton: document.querySelector("#export-recorder-dictionary")
};

let database;
let databaseReady;
let mediaRecorder;
let audioContext;
let audioBuffer;
let audioChunks = [];
let isRecording = false;
let startRatio = 0;
let endRatio = 1;
let activeHandle;
let playbackSource;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
      store.createIndex("lemma", "lemma");
      store.createIndex("ref", "ref");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function setStatus(text, state = "ready") {
  ui.status.textContent = text;
  ui.status.dataset.state = state;
}

function setView(view) {
  const showDictionary = view === "dictionary";
  ui.captureView.hidden = showDictionary;
  ui.dictionaryView.hidden = !showDictionary;
  ui.captureTab.setAttribute("aria-selected", String(!showDictionary));
  ui.dictionaryTab.setAttribute("aria-selected", String(showDictionary));
  if (showDictionary) loadDictionary();
}

function resizeCanvas() {
  const { canvas } = ui;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  drawWaveform();
}

function drawWaveform() {
  const { canvas } = ui;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  const context = canvas.getContext("2d");
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, width, height);
  if (!audioBuffer) return;

  const samples = audioBuffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.ceil(samples.length / width));
  const amplitude = height / 2;
  context.lineWidth = 1;
  context.strokeStyle = "#475569";
  context.beginPath();
  for (let x = 0; x < width; x += 1) {
    const [minimum, maximum] = sampleRange(samples, x * samplesPerPixel, samplesPerPixel);
    context.moveTo(x, (1 + minimum) * amplitude);
    context.lineTo(x, (1 + maximum) * amplitude);
  }
  context.stroke();

  const fromX = startRatio * width;
  const toX = endRatio * width;
  context.fillStyle = "rgb(59 130 246 / 15%)";
  context.fillRect(fromX, 0, toX - fromX, height);
  context.strokeStyle = "#60a5fa";
  context.lineWidth = 1.5;
  context.beginPath();
  for (let x = Math.floor(fromX); x <= Math.ceil(toX); x += 1) {
    const [minimum, maximum] = sampleRange(samples, x * samplesPerPixel, samplesPerPixel);
    context.moveTo(x, (1 + minimum) * amplitude);
    context.lineTo(x, (1 + maximum) * amplitude);
  }
  context.stroke();
  drawHandle(context, fromX, height, "#10b981");
  drawHandle(context, toX, height, "#ef4444");
}

function sampleRange(samples, start, count) {
  let minimum = 1;
  let maximum = -1;
  const limit = Math.min(samples.length, start + count);
  for (let index = start; index < limit; index += 1) {
    minimum = Math.min(minimum, samples[index]);
    maximum = Math.max(maximum, samples[index]);
  }
  return minimum === 1 && maximum === -1 ? [0, 0] : [minimum, maximum];
}

function drawHandle(context, x, height, color) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
  context.beginPath();
  context.arc(x, height / 2, 7, 0, Math.PI * 2);
  context.fill();
}

function updateTrimReadout() {
  if (!audioBuffer) return;
  const duration = audioBuffer.duration;
  ui.trimStart.textContent = `Start: ${(startRatio * duration).toFixed(2)}s`;
  ui.trimDuration.textContent = `Duration: ${((endRatio - startRatio) * duration).toFixed(2)}s`;
  ui.trimEnd.textContent = `End: ${(endRatio * duration).toFixed(2)}s`;
}

function setupTrimInteraction() {
  const { canvas } = ui;
  canvas.addEventListener("pointerdown", (event) => {
    if (!audioBuffer) return;
    const bounds = canvas.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    if (Math.abs(position - startRatio) < 0.08) activeHandle = "start";
    else if (Math.abs(position - endRatio) < 0.08) activeHandle = "end";
    if (activeHandle) {
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!activeHandle || !audioBuffer) return;
    const bounds = canvas.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    if (activeHandle === "start") {
      startRatio = Math.max(0, Math.min(position, endRatio - minimumTrimRatio));
    } else {
      endRatio = Math.min(1, Math.max(position, startRatio + minimumTrimRatio));
    }
    drawWaveform();
    updateTrimReadout();
  });
  const releaseHandle = () => { activeHandle = null; };
  canvas.addEventListener("pointerup", releaseHandle);
  canvas.addEventListener("pointercancel", releaseHandle);
  window.addEventListener("resize", resizeCanvas);
}

function setRecordingUi(recording) {
  isRecording = recording;
  ui.recordButton.textContent = recording ? "Stop" : "Record";
  ui.recordButton.setAttribute("aria-label", recording ? "Stop recording" : "Start recording");
  ui.recordButton.setAttribute("aria-pressed", String(recording));
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("Audio recording is not supported by this browser.", "error");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    audioBuffer = null;
    startRatio = 0;
    endRatio = 1;
    ui.clearButton.disabled = true;
    ui.playButton.disabled = true;
    ui.placeholder.hidden = false;
    ui.trimReadout.hidden = true;
    drawWaveform();
    const recorder = new MediaRecorder(stream);
    mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) audioChunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      setStatus("Processing audio…", "processing");
      ui.recordButton.disabled = true;
      try {
        const blob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
        audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
        audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
        startRatio = 0;
        endRatio = 1;
        ui.clearButton.disabled = false;
        ui.playButton.disabled = false;
        ui.placeholder.hidden = true;
        ui.trimReadout.hidden = false;
        resizeCanvas();
        updateTrimReadout();
        setStatus("Audio ready to trim", "ready");
      } catch {
        setStatus("Could not process this recording. Try recording again.", "error");
        ui.placeholder.hidden = false;
      } finally {
        ui.recordButton.disabled = false;
      }
    }, { once: true });
    recorder.start();
    setRecordingUi(true);
    setStatus("Recording…", "recording");
  } catch {
    setStatus("Microphone access was denied or is unavailable.", "error");
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  setRecordingUi(false);
  mediaRecorder.stop();
}

function createTrimmedBuffer() {
  if (!audioBuffer) return null;
  const startFrame = Math.floor(startRatio * audioBuffer.length);
  const endFrame = Math.floor(endRatio * audioBuffer.length);
  const frameCount = Math.max(1, endFrame - startFrame);
  const context = audioContext ?? new (window.AudioContext || window.webkitAudioContext)();
  const trimmed = context.createBuffer(audioBuffer.numberOfChannels, frameCount, audioBuffer.sampleRate);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    trimmed.copyToChannel(audioBuffer.getChannelData(channel).subarray(startFrame, endFrame), channel);
  }
  return trimmed;
}

function encodeWave(buffer) {
  const channelCount = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const byteLength = 44 + frameCount * channelCount * 2;
  const array = new ArrayBuffer(byteLength);
  const view = new DataView(array);
  let position = 0;
  const write16 = (value) => { view.setUint16(position, value, true); position += 2; };
  const write32 = (value) => { view.setUint32(position, value, true); position += 4; };
  write32(0x46464952);
  write32(byteLength - 8);
  write32(0x45564157);
  write32(0x20746d66);
  write32(16);
  write16(1);
  write16(channelCount);
  write32(buffer.sampleRate);
  write32(buffer.sampleRate * channelCount * 2);
  write16(channelCount * 2);
  write16(16);
  write32(0x61746164);
  write32(byteLength - position - 4);
  const channels = Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(position, sample < 0 ? sample * 32768 : sample * 32767, true);
      position += 2;
    }
  }
  return new Blob([array], { type: "audio/wav" });
}

async function playTrimmedAudio() {
  const trimmed = createTrimmedBuffer();
  if (!trimmed) return;
  try {
    await audioContext.resume();
    playbackSource?.stop();
    playbackSource = audioContext.createBufferSource();
    playbackSource.buffer = trimmed;
    playbackSource.connect(audioContext.destination);
    playbackSource.addEventListener("ended", () => {
      playbackSource = null;
      ui.playButton.textContent = "Play clip";
    }, { once: true });
    playbackSource.start();
    ui.playButton.textContent = "Playing…";
  } catch {
    setStatus("Unable to play this clip.", "error");
  }
}

function clearRecording() {
  if (isRecording) stopRecording();
  playbackSource?.stop();
  playbackSource = null;
  audioBuffer = null;
  startRatio = 0;
  endRatio = 1;
  ui.clearButton.disabled = true;
  ui.playButton.disabled = true;
  ui.trimReadout.hidden = true;
  ui.placeholder.hidden = false;
  ui.playButton.textContent = "Play clip";
  setStatus("Ready", "ready");
  const context = ui.canvas.getContext("2d");
  context.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
}

async function saveEntry(event) {
  event.preventDefault();
  if (!ui.form.reportValidity()) return;
  const entry = {
    lemma: ui.lemma.value.trim(),
    ipa: ui.ipa.value.trim(),
    gloss: ui.gloss.value.trim(),
    syntax: ui.syntax.value,
    ref: ui.reference.value.trim(),
    morph: ui.morphology.value.trim(),
    audioBlob: audioBuffer ? encodeWave(createTrimmedBuffer()) : null,
    createdAt: new Date().toISOString()
  };
  if (!entry.lemma) {
    ui.lemma.focus();
    return;
  }
  try {
    await databaseReady;
    await storeRequest("readwrite", (store) => store.add(entry));
    ui.form.reset();
    ui.ipaKeyboard.hidden = true;
    ui.ipaToggle.setAttribute("aria-expanded", "false");
    clearRecording();
    setView("dictionary");
    setStatus("Entry saved", "ready");
  } catch {
    setStatus("Could not save the entry. Check browser storage and try again.", "error");
  }
}

async function loadDictionary() {
  try {
    await databaseReady;
    const entries = await storeRequest("readonly", (store) => store.getAll());
    ui.count.textContent = String(entries.length);
    const query = ui.search.value.trim().toLocaleLowerCase();
    const filtered = entries.filter((entry) =>
      [entry.lemma, entry.ipa, entry.gloss, entry.ref]
        .some((value) => value?.toLocaleLowerCase().includes(query))
    ).sort((left, right) => right.id - left.id);
    renderEntries(filtered);
  } catch {
    ui.empty.textContent = "Unable to load the local dictionary. Browser storage may be unavailable.";
    ui.empty.hidden = false;
  }
}

function renderEntries(entries) {
  ui.entries.replaceChildren();
  ui.empty.hidden = entries.length > 0;
  if (!entries.length) return;
  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "recorder-entry";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = entry.lemma;
    details.append(title);
    const description = [entry.ipa, entry.gloss, entry.syntax, entry.ref, entry.morph].filter(Boolean).join(" · ");
    if (description) {
      const text = document.createElement("p");
      text.textContent = description;
      details.append(text);
    }
    const actions = document.createElement("div");
    actions.className = "recorder-entry-actions";
    if (entry.audioBlob) {
      const play = document.createElement("button");
      play.type = "button";
      play.textContent = "Play";
      play.setAttribute("aria-label", `Play recording for ${entry.lemma}`);
      play.addEventListener("click", () => playSavedAudio(entry.audioBlob, play));
      actions.append(play);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${entry.lemma}`);
    remove.addEventListener("click", () => deleteEntry(entry.id));
    actions.append(remove);
    card.append(details, actions);
    ui.entries.append(card);
  }
}

function playSavedAudio(blob, button) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  button.disabled = true;
  audio.addEventListener("ended", () => {
    URL.revokeObjectURL(url);
    button.disabled = false;
  }, { once: true });
  audio.addEventListener("error", () => {
    URL.revokeObjectURL(url);
    button.disabled = false;
    setStatus("Unable to play this saved recording.", "error");
  }, { once: true });
  audio.play().catch(() => {
    URL.revokeObjectURL(url);
    button.disabled = false;
    setStatus("Unable to play this saved recording.", "error");
  });
}

async function deleteEntry(id) {
  if (!window.confirm("Delete this dictionary entry?")) return;
  try {
    await storeRequest("readwrite", (store) => store.delete(id));
    await loadDictionary();
  } catch {
    setStatus("Could not delete the entry.", "error");
  }
}

async function exportDictionary() {
  try {
    await databaseReady;
    const entries = await storeRequest("readonly", (store) => store.getAll());
    const exportData = await Promise.all(entries.map(async ({ audioBlob, ...entry }) => ({
      ...entry,
      audioBase64: audioBlob ? await blobToBase64(audioBlob) : null
    })));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    downloadBlob(blob, `macula_dictionary_${new Date().toISOString().slice(0, 10)}.json`);
  } catch {
    setStatus("Could not export the dictionary.", "error");
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setupIpaKeyboard() {
  const fragment = document.createDocumentFragment();
  for (const symbol of ipaSymbols) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = symbol;
    button.setAttribute("aria-label", `Insert ${symbol}`);
    button.addEventListener("click", () => {
      const input = ui.ipa;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(symbol, start, end, "end");
      input.focus();
    });
    fragment.append(button);
  }
  ui.ipaKeyboard.replaceChildren(fragment);
}

function initialize() {
  if (!ui.dialog || !ui.openButton) return;
  ui.openButton.addEventListener("click", async () => {
    ui.dialog.showModal();
    resizeCanvas();
    loadDictionary();
  });
  ui.closeButton.addEventListener("click", () => {
    if (isRecording) stopRecording();
    ui.dialog.close();
  });
  ui.dialog.addEventListener("close", () => {
    if (isRecording) stopRecording();
    ui.openButton.focus();
  });
  ui.captureTab.addEventListener("click", () => setView("capture"));
  ui.dictionaryTab.addEventListener("click", () => setView("dictionary"));
  ui.recordButton.addEventListener("click", () => isRecording ? stopRecording() : startRecording());
  ui.clearButton.addEventListener("click", clearRecording);
  ui.playButton.addEventListener("click", playTrimmedAudio);
  ui.form.addEventListener("submit", saveEntry);
  ui.search.addEventListener("input", loadDictionary);
  ui.exportButton.addEventListener("click", exportDictionary);
  ui.ipaToggle.addEventListener("click", () => {
    ui.ipaKeyboard.hidden = !ui.ipaKeyboard.hidden;
    ui.ipaToggle.setAttribute("aria-expanded", String(!ui.ipaKeyboard.hidden));
  });
  setupTrimInteraction();
  setupIpaKeyboard();
  databaseReady = openDatabase().then((opened) => {
    database = opened;
    return opened;
  }).catch(() => {
    setStatus("Local dictionary storage is unavailable.", "error");
    return null;
  });
}

document.addEventListener("DOMContentLoaded", initialize, { once: true });
