import { writingSystems, importLift, exportLift, stableRecords, mergeLift } from "./lift-exchange.js";

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
let isRecording = false;
let startRatio = 0;
let endRatio = 1;
let activeHandle;
let playbackSource;
let savingEntry = false;
let recorderTrigger;
let recordingCard;
let recordingStream;
let captureContext;
let captureSource;
let analyser;
let waveformFrame;
let liveSamples;
let captureGeneration = 0;
let dictionaryEntries = [];
let cardRecordings = new Map();
let savedPlayback;
let dictionaryGeneration = 0;

function cardId(card) {
  const verse = card.closest(".verse")?.dataset.verse;
  return verse && card.dataset.alignmentId ? `${verse}:${card.dataset.alignmentId}` : "";
}

function bindingKey(value) {
  const { languageCode, lemmaId, senseId } = value;
  return [languageCode, lemmaId, senseId].every((part) => typeof part === "string" && part.trim())
    ? JSON.stringify([languageCode, lemmaId, senseId]) : "";
}

function cardBinding(card) {
  return {
    languageCode: card.dataset.language || "",
    lemmaId: card.dataset.lemmaId || "",
    senseId: card.dataset.senseId || ""
  };
}

function targetText(card) {
  return (card.querySelector(".ruby-base") ?? card.querySelector(".target-text"))?.textContent.trim() || "";
}

function referenceIds(value) {
  return [...new Set((Array.isArray(value) ? value.join(",") : String(value || ""))
    .split(/[,\s;]+/u).filter(Boolean))];
}

function inferBinding(entry, cards) {
  const refs = new Set(referenceIds(entry.ref || entry.maculaIds));
  if (!refs.size) return null;
  // Legacy refs may cover several Greek words now represented by separate cards.
  const matches = cards.filter((card) => {
    const ids = referenceIds(card.dataset.maculaIds);
    return ids.length && ids.every((id) => refs.has(id));
  });
  if (!matches.length) return null;
  const normalize = (text) => String(text || "").normalize("NFC").trim().replace(/\s+/gu, " ");
  const gloss = normalize(entry.gloss);
  const glossMatches = gloss ? matches.filter((card) =>
    normalize(targetText(card)) === gloss || normalize(card.dataset.legacyTargetText) === gloss) : [];
  const targets = glossMatches.length ? glossMatches : matches;
  const languages = new Set(targets.map((card) => card.dataset.language));
  if (languages.size !== 1 || !targets[0].dataset.language?.trim()) return null;
  const keys = new Set(targets.map((card) => bindingKey(cardBinding(card))));
  if (keys.size !== 1) return null;
  if (keys.has("") && targets.length !== 1) return null;
  return { targets, key: bindingKey(cardBinding(targets[0])) };
}

function refreshAudioButtons() {
  const cards = [...document.querySelectorAll(".token-card")];
  const shared = document.querySelector("#apply-shared-edits")?.checked !== false;
  cardRecordings = new Map();
  for (const entry of [...dictionaryEntries].sort((left, right) => left.id - right.id)) {
    if (!entry.audioBlob) continue;
    const key = bindingKey(entry);
    let targets;
    if (Array.isArray(entry.cardIds)) {
      const ids = new Set(entry.cardIds);
      targets = cards.filter((card) => (ids.has(cardId(card))
        && (!entry.languageCode || entry.languageCode === card.dataset.language))
        || (shared && entry.sharedBinding === true && key && bindingKey(cardBinding(card)) === key));
    } else if (key) {
      targets = shared && entry.sharedBinding !== false
        ? cards.filter((card) => bindingKey(cardBinding(card)) === key) : [];
    } else {
      const inferred = inferBinding(entry, cards);
      if (!inferred) continue;
      targets = cards.filter((card) => inferred.targets.includes(card)
        || (shared && inferred.key && bindingKey(cardBinding(card)) === inferred.key));
    }
    for (const card of targets) {
      if (cardId(card)) cardRecordings.set(cardId(card), entry);
    }
  }
  if (savedPlayback?.card && (!savedPlayback.card.isConnected
    || cardRecordings.get(cardId(savedPlayback.card)) !== savedPlayback.entry)) stopSavedPlayback();
  for (const card of cards) {
    const button = card.querySelector(".play-token");
    if (!button) continue;
    const available = cardRecordings.has(cardId(card));
    button.disabled = !available;
    button.setAttribute("aria-label", available
      ? `Play pronunciation for ${targetText(card)}` : `No recording for ${targetText(card)}`);
    button.title = available ? "Play pronunciation" : "No recording available";
  }
}

function cleanupCapture() {
  if (waveformFrame !== undefined) cancelAnimationFrame(waveformFrame);
  waveformFrame = undefined;
  captureSource?.disconnect();
  analyser?.disconnect();
  captureSource = null;
  analyser = null;
  liveSamples = null;
  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  if (captureContext) captureContext.close().catch(() => {});
  captureContext = null;
}

function stopTrimPlayback() {
  if (playbackSource) {
    playbackSource.onended = null;
    try { playbackSource.stop(); } catch { /* A source that failed to start has nothing to stop. */ }
    playbackSource.disconnect();
    playbackSource = null;
  }
  ui.playButton.textContent = "Play clip";
}

function discardCapture() {
  captureGeneration += 1;
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  mediaRecorder = null;
  cleanupCapture();
  setRecordingUi(false);
  ui.recordButton.disabled = false;
  stopTrimPlayback();
}

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
  const style = getComputedStyle(document.documentElement);
  const color = (name) => style.getPropertyValue(name).trim();
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = color("--bg-color");
  context.fillRect(0, 0, width, height);
  if (isRecording && analyser && liveSamples) {
    analyser.getFloatTimeDomainData(liveSamples);
    context.strokeStyle = color("--greek-color");
    context.lineWidth = 2;
    context.beginPath();
    for (let index = 0; index < liveSamples.length; index += 1) {
      const x = index * width / (liveSamples.length - 1);
      const y = (1 - liveSamples[index]) * height / 2;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    return;
  }
  if (!audioBuffer) return;

  const samples = audioBuffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.ceil(samples.length / width));
  const amplitude = height / 2;
  context.lineWidth = 1;
  context.strokeStyle = color("--text-muted");
  context.beginPath();
  for (let x = 0; x < width; x += 1) {
    const [minimum, maximum] = sampleRange(samples, x * samplesPerPixel, samplesPerPixel);
    context.moveTo(x, (1 + minimum) * amplitude);
    context.lineTo(x, (1 + maximum) * amplitude);
  }
  context.stroke();

  const fromX = startRatio * width;
  const toX = endRatio * width;
  context.fillStyle = color("--edited-bg");
  context.fillRect(fromX, 0, toX - fromX, height);
  context.strokeStyle = color("--greek-color");
  context.lineWidth = 1.5;
  context.beginPath();
  for (let x = Math.floor(fromX); x <= Math.ceil(toX); x += 1) {
    const [minimum, maximum] = sampleRange(samples, x * samplesPerPixel, samplesPerPixel);
    context.moveTo(x, (1 + minimum) * amplitude);
    context.lineTo(x, (1 + maximum) * amplitude);
  }
  context.stroke();
  drawHandle(context, fromX, height, color("--english-color"));
  drawHandle(context, toX, height, color("--ruby-color"));
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
  const generation = ++captureGeneration;
  ui.recordButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!ui.dialog.open || generation !== captureGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    recordingStream = stream;
    stopTrimPlayback();
    stopSavedPlayback();
    const chunks = [];
    audioBuffer = null;
    startRatio = 0;
    endRatio = 1;
    ui.clearButton.disabled = true;
    ui.playButton.disabled = true;
    ui.placeholder.hidden = true;
    ui.trimReadout.hidden = true;
    drawWaveform();
    const recorder = new MediaRecorder(stream);
    mediaRecorder = recorder;
    captureContext = new (window.AudioContext || window.webkitAudioContext)();
    const context = captureContext;
    captureSource = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    liveSamples = new Float32Array(analyser.fftSize);
    captureSource.connect(analyser);
    await context.resume();
    if (generation !== captureGeneration) return;
    if (!ui.dialog.open) {
      discardCapture();
      return;
    }
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      if (generation !== captureGeneration) return;
      cleanupCapture();
      mediaRecorder = null;
      setRecordingUi(false);
      setStatus("Processing audio…", "processing");
      ui.recordButton.disabled = true;
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
        if (generation !== captureGeneration || !ui.dialog.open) return;
        audioBuffer = decoded;
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
        if (generation !== captureGeneration) return;
        setStatus("Could not process this recording. Try recording again.", "error");
        ui.placeholder.hidden = false;
      } finally {
        if (generation === captureGeneration) ui.recordButton.disabled = false;
      }
    }, { once: true });
    recorder.addEventListener("error", () => {
      if (generation !== captureGeneration) return;
      discardCapture();
      ui.placeholder.hidden = false;
      setStatus("Recording failed. Try recording again.", "error");
    }, { once: true });
    recorder.start();
    setRecordingUi(true);
    const drawLive = () => {
      if (!isRecording || generation !== captureGeneration) return;
      drawWaveform();
      waveformFrame = requestAnimationFrame(drawLive);
    };
    drawLive();
    setStatus("Recording…", "recording");
  } catch {
    if (generation !== captureGeneration) return;
    discardCapture();
    ui.placeholder.hidden = false;
    setStatus("Microphone access was denied or is unavailable.", "error");
  } finally {
    if (generation === captureGeneration) ui.recordButton.disabled = false;
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  setRecordingUi(false);
  ui.recordButton.disabled = true;
  try {
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } finally {
    cleanupCapture();
  }
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
    stopSavedPlayback();
    stopTrimPlayback();
    const source = audioContext.createBufferSource();
    playbackSource = source;
    source.buffer = trimmed;
    source.connect(audioContext.destination);
    source.onended = () => {
      source.disconnect();
      if (playbackSource !== source) return;
      playbackSource = null;
      ui.playButton.textContent = "Play clip";
    };
    source.start();
    ui.playButton.textContent = "Playing…";
  } catch {
    stopTrimPlayback();
    setStatus("Unable to play this clip.", "error");
  }
}

function clearRecording() {
  discardCapture();
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
  if (savingEntry || !ui.form.reportValidity()) return;
  if (isRecording || ui.recordButton.disabled) {
    setStatus("Stop recording and wait for audio processing before saving.", "processing");
    return;
  }
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
  if (recordingCard) {
    Object.assign(entry, cardBinding(recordingCard), {
      cardIds: [cardId(recordingCard)].filter(Boolean),
      sharedBinding: document.querySelector("#apply-shared-edits")?.checked === true
    });
  }
  if (!entry.lemma) {
    ui.lemma.focus();
    return;
  }
  const saveButton = ui.form.querySelector('button[type="submit"]');
  savingEntry = true;
  saveButton.disabled = true;
  try {
    await databaseReady;
    await storeRequest("readwrite", (store) => store.add(entry));
    await loadDictionary();
    ui.form.reset();
    recordingCard = null;
    ui.ipaKeyboard.hidden = true;
    ui.ipaToggle.setAttribute("aria-expanded", "false");
    clearRecording();
    setView("dictionary");
    setStatus("Entry saved", "ready");
  } catch {
    setStatus("Could not save the entry. Check browser storage and try again.", "error");
  } finally {
    savingEntry = false;
    saveButton.disabled = false;
  }
}

async function loadDictionary() {
  const generation = ++dictionaryGeneration;
  try {
    await databaseReady;
    const entries = await storeRequest("readonly", (store) => store.getAll());
    if (generation !== dictionaryGeneration) return;
    dictionaryEntries = entries;
    stopSavedPlayback();
    refreshAudioButtons();
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
      play.addEventListener("click", () => playSavedAudio(entry.audioBlob, play, entry));
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

function stopSavedPlayback() {
  if (!savedPlayback) return;
  const { audio, url, button } = savedPlayback;
  savedPlayback = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  URL.revokeObjectURL(url);
  button.disabled = false;
}

function playbackError() {
  const message = "Unable to play this saved recording.";
  setStatus(message, "error");
  const status = document.querySelector("#edit-status");
  if (status) {
    status.textContent = message;
    status.dataset.state = "error";
  }
}

function playSavedAudio(blob, button, entry, card = null) {
  stopSavedPlayback();
  stopTrimPlayback();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const playback = { audio, url, button, entry, card };
  savedPlayback = playback;
  const finish = (failed = false) => {
    if (savedPlayback !== playback) return;
    stopSavedPlayback();
    if (failed) playbackError();
  };
  audio.onended = () => finish();
  audio.onerror = () => finish(true);
  try {
    Promise.resolve(audio.play()).catch(() => finish(true));
  } catch {
    finish(true);
  }
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

function setupLiftExchange() {
  const form = document.querySelector("#recorder-lift-form");
  const status = document.querySelector("#recorder-lift-status");
  const buttons = [...form.querySelectorAll("button")];
  let busy = false;
  const exchange = async (importing) => {
    if (busy || !form.reportValidity()) return;
    busy = true;
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = importing ? "Reading and validating files…" : "Preparing the full dictionary…";
    try {
      const languages = writingSystems(form.elements.vernacular.value.trim(), form.elements.gloss.value.trim());
      await databaseReady;
      if (!database) throw new Error("Local dictionary storage is unavailable.");
      if (importing) {
        const parsed = await importLift(form.elements.files.files, languages);
        const warning = `Import ${parsed.records.length} dictionary records? This is a limited projection, NOT a lossless FLEx backup. Only the selected lexical/gloss languages, IPA, first audio and supported fields are kept. Other languages, examples, relations, variants, subsenses and rich formatting are discarded. Keep your original FLEx files.\n\n${parsed.missingAudio} entries have missing audio; existing audio is retained. ${parsed.missingGloss} records have no selected-language gloss. ${parsed.deleted} deletion markers are ignored. Matching entry/sense IDs will be updated; other local entries will not be deleted.`;
        if (!window.confirm(warning)) { status.textContent = "Import cancelled. No entries changed."; return; }
        const result = await mergeLift(database, storeName, parsed.records);
        await loadDictionary();
        status.textContent = `Imported: ${result.added} added, ${result.updated} updated. Missing audio: ${parsed.missingAudio}; missing gloss: ${parsed.missingGloss}. Original FLEx files remain your full backup.`;
      } else {
        const records = await stableRecords(database, storeName);
        const blob = await exportLift(records, languages);
        downloadBlob(blob, `macula_dictionary_${new Date().toISOString().slice(0, 10)}.zip`);
        status.textContent = `Exported all ${records.length} dictionary records as LIFT 0.13 with local audio. Extract the ZIP before importing its .lift into FLEx.`;
      }
    } catch (error) {
      status.textContent = `${importing ? "Import" : "Export"} failed: ${error.message || "Check browser storage and your files."}`;
    } finally {
      busy = false;
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); exchange(true); });
  document.querySelector("#export-recorder-lift").addEventListener("click", () => exchange(false));
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
  const openRecorder = (trigger) => {
    recorderTrigger = trigger;
    if (!ui.dialog.open) ui.dialog.showModal();
    resizeCanvas();
    loadDictionary();
  };
  ui.openButton.addEventListener("click", () => {
    if (!audioBuffer && !ui.lemma.value.trim()) recordingCard = null;
    openRecorder(ui.openButton);
  });
  document.addEventListener("recordcard", (event) => {
      const { card, trigger } = event.detail || {};
      if (!card?.matches(".token-card") || !card.isConnected) return;
      if (isRecording || ui.recordButton.disabled) {
        setView("capture");
        openRecorder(trigger);
        setStatus("Stop recording and wait for audio processing before choosing another word.", "processing");
        return;
      }
      const hasDraft = audioBuffer || isRecording || [...ui.form.querySelectorAll("input")]
        .some((input) => input.value.trim());
      if (hasDraft && !window.confirm("Replace the current recorder draft with this word?")) return;
      if (hasDraft) clearRecording();
      recordingCard = card;
      ui.form.reset();
      ui.lemma.value = card.querySelector(".sub-greek")?.textContent.trim() || targetText(card);
      ui.gloss.value = targetText(card);
      ui.reference.value = card.dataset.maculaIds || "";
      setView("capture");
      openRecorder(trigger);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".play-token");
    if (!button || button.disabled) return;
    const card = button.closest(".token-card");
    const entry = card && cardRecordings.get(cardId(card));
    if (entry?.audioBlob) playSavedAudio(entry.audioBlob, button, entry, card);
  });
  document.addEventListener("cardschanged", refreshAudioButtons);
  document.querySelector("#apply-shared-edits")?.addEventListener("change", refreshAudioButtons);
  new MutationObserver(() => {
    if (ui.dialog.open) drawWaveform();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("pagehide", () => {
    discardCapture();
    stopSavedPlayback();
    audioContext?.close().catch(() => {});
    audioContext = null;
  });
  ui.closeButton.addEventListener("click", () => {
    ui.dialog.close();
  });
  ui.dialog.addEventListener("close", () => {
    discardCapture();
    stopSavedPlayback();
    ui.placeholder.hidden = Boolean(audioBuffer);
    recorderTrigger?.focus();
  });
  ui.captureTab.addEventListener("click", () => setView("capture"));
  ui.dictionaryTab.addEventListener("click", () => setView("dictionary"));
  ui.recordButton.addEventListener("click", () => isRecording ? stopRecording() : startRecording());
  ui.clearButton.addEventListener("click", clearRecording);
  ui.playButton.addEventListener("click", playTrimmedAudio);
  ui.form.addEventListener("submit", saveEntry);
  ui.search.addEventListener("input", loadDictionary);
  ui.exportButton.addEventListener("click", exportDictionary);
  setupLiftExchange();
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
  loadDictionary();
}

document.addEventListener("DOMContentLoaded", initialize, { once: true });
