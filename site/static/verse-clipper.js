const defaultClipSeconds = 0.5;
const trimViewSeconds = 1;
const trimViewLeadSeconds = 0.15;
const onsetWindowSeconds = 0.01;
const onsetLeadSeconds = 0.05;
const onsetMinimumRms = 0.01;
const onsetPeakRatio = 0.1;
const minimumClipSeconds = 0.05;
const minimumViewSeconds = 0.25;
const zoomFactor = 2;
const handleTolerancePx = 12;

export function setupVerseClipper(api) {
  const dialog = document.querySelector("#verse-clipper");
  if (!dialog) return { refresh() {}, hasSession: () => false };
  const ui = {
    title: document.querySelector("#verse-clipper-title"),
    context: document.querySelector("#verse-clipper-context"),
    status: document.querySelector("#verse-clipper-status"),
    canvas: document.querySelector("#verse-clipper-waveform"),
    placeholder: document.querySelector("#verse-clipper-placeholder"),
    zoomOut: document.querySelector("#verse-zoom-out"),
    zoomFit: document.querySelector("#verse-zoom-fit"),
    zoomIn: document.querySelector("#verse-zoom-in"),
    pan: document.querySelector("#verse-pan"),
    viewRange: document.querySelector("#verse-view-range"),
    start: document.querySelector("#verse-clip-start"),
    end: document.querySelector("#verse-clip-end"),
    duration: document.querySelector("#verse-clip-duration"),
    play: document.querySelector("#verse-clip-play"),
    record: document.querySelector("#verse-record"),
    save: document.querySelector("#verse-clip-save"),
    words: document.querySelector("#verse-clip-words"),
    close: document.querySelector("#close-verse-clipper")
  };
  // Verse recordings are kept for this page session so clips can be trimmed after closing the dialog.
  const sessions = new Map();
  let verse = null;
  let session = null;
  let selectedCard = null;
  let selection = { start: 0, end: 0 };
  let view = { start: 0, end: 0 };
  let audioContext;
  let mediaRecorder;
  let stream;
  let captureContext;
  let analyser;
  let liveSamples;
  let frame;
  let generation = 0;
  let recording = false;
  let processing = false;
  let saving = false;
  let playbackSource;
  let activeHandle = null;
  let trigger = null;

  const verseKey = (element) => `${element.lang}:${element.dataset.verse}`;
  const duration = () => session?.buffer.duration || 0;
  const verseCards = () => (verse ? [...verse.querySelectorAll(".token-card")] : []);
  const hasText = (card) => Boolean(api.targetText(card));

  function setStatus(text, state = "ready") {
    ui.status.textContent = text;
    ui.status.dataset.state = state;
  }

  function cardLabel(card) {
    return api.targetText(card) || card.querySelector(".sub-greek")?.textContent.trim() || "word";
  }

  function renderWords() {
    const fragment = document.createDocumentFragment();
    for (const card of verseCards()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clip-word";
      button.dataset.cardId = api.cardId(card);
      const text = document.createElement("span");
      text.className = "clip-word-text";
      text.textContent = api.targetText(card) || "(untranslated)";
      const greek = document.createElement("span");
      greek.className = "clip-word-greek";
      greek.lang = "grc";
      greek.textContent = card.querySelector(".sub-greek")?.textContent.trim() || "";
      const lemma = document.createElement("span");
      lemma.className = "clip-word-lemma";
      lemma.lang = "grc";
      const lemmas = api.sourceLemmas(card);
      lemma.textContent = lemmas.length ? `lemma ${lemmas.join(" ")}` : "";
      button.append(text, greek, lemma);
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-disabled") === "true") {
          if (!session && !recording && !processing) setStatus("Record the whole verse first, then select a word.", "ready");
          return;
        }
        selectCard(card);
      });
      fragment.append(button);
    }
    ui.words.replaceChildren(fragment);
    updateWordStates();
  }

  function updateWordStates() {
    const cards = new Map(verseCards().map((card) => [api.cardId(card), card]));
    for (const button of ui.words.querySelectorAll(".clip-word")) {
      const card = cards.get(button.dataset.cardId);
      if (!card) continue;
      const hasAudio = api.hasRecording(card);
      const trimmed = session?.clips.get(button.dataset.cardId);
      button.classList.toggle("has-audio", hasAudio);
      // Words stay fully visible; the check mark, not greying, shows which have audio.
      button.setAttribute("aria-disabled", String(!session || recording || processing || saving));
      button.setAttribute("aria-pressed", String(card === selectedCard));
      const state = hasAudio ? "has audio; select to replace it" : "no audio";
      const range = trimmed ? `, trimmed ${trimmed.start.toFixed(2)}–${trimmed.end.toFixed(2)}s` : "";
      button.setAttribute("aria-label", `${cardLabel(card)} (${api.sourceLemmas(card).join(" ") || "no source lemma"}), ${state}${range}`);
      button.title = hasAudio ? "Already has audio. Select to record a replacement clip." : "Select to trim its clip";
    }
  }

  function updateControls() {
    const ready = Boolean(session) && !recording && !processing;
    const length = view.end - view.start;
    ui.zoomIn.disabled = !ready || length <= minimumViewSeconds + 1e-6;
    ui.zoomOut.disabled = !ready || length >= duration() - 1e-6;
    ui.zoomFit.disabled = ui.zoomOut.disabled;
    ui.pan.disabled = ui.zoomOut.disabled;
    const scrollable = duration() - length;
    ui.pan.value = scrollable > 0 ? String(Math.round(view.start / scrollable * 1000)) : "0";
    ui.viewRange.textContent = session ? `${view.start.toFixed(2)}–${view.end.toFixed(2)}s` : "0.00–0.00s";
    const selected = ready && Boolean(selectedCard);
    ui.start.disabled = !selected;
    ui.end.disabled = !selected;
    ui.play.disabled = !selected;
    ui.save.disabled = !selected || saving;
    ui.start.max = ui.end.max = duration().toFixed(2);
    ui.start.value = selection.start.toFixed(2);
    ui.end.value = selection.end.toFixed(2);
    ui.duration.textContent = `Duration: ${(selection.end - selection.start).toFixed(2)}s`;
    ui.record.disabled = processing || saving;
    ui.placeholder.hidden = Boolean(session) || recording;
    updateWordStates();
  }

  function resizeCanvas() {
    const rect = ui.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    ui.canvas.width = Math.round(rect.width * ratio);
    ui.canvas.height = Math.round(rect.height * ratio);
    draw();
  }

  function sampleRange(samples, start, end) {
    let minimum = 1;
    let maximum = -1;
    const limit = Math.min(samples.length, Math.max(start + 1, end));
    for (let index = Math.max(0, start); index < limit; index += 1) {
      if (samples[index] < minimum) minimum = samples[index];
      if (samples[index] > maximum) maximum = samples[index];
    }
    return minimum > maximum ? [0, 0] : [minimum, maximum];
  }

  function draw() {
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
    if (recording && analyser && liveSamples) {
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
    if (!session) return;
    const { buffer } = session;
    const samples = buffer.getChannelData(0);
    const length = view.end - view.start;
    const toX = (time) => (time - view.start) / length * width;
    const sampleAt = (x) => Math.floor((view.start + x / width * length) * buffer.sampleRate);
    for (const [id, clip] of session.clips) {
      if (selectedCard && id === api.cardId(selectedCard)) continue;
      context.fillStyle = color("--inserted-bg");
      context.fillRect(toX(clip.start), 0, toX(clip.end) - toX(clip.start), height);
    }
    const fromX = toX(selection.start);
    const untilX = toX(selection.end);
    if (selectedCard) {
      context.fillStyle = color("--edited-bg");
      context.fillRect(fromX, 0, untilX - fromX, height);
    }
    const amplitude = height / 2;
    for (const highlighted of [false, true]) {
      if (highlighted && !selectedCard) break;
      context.lineWidth = highlighted ? 1.5 : 1;
      context.strokeStyle = color(highlighted ? "--greek-color" : "--text-muted");
      context.beginPath();
      const first = highlighted ? Math.max(0, Math.floor(fromX)) : 0;
      const last = highlighted ? Math.min(width, Math.ceil(untilX)) : width;
      for (let x = first; x < last; x += 1) {
        const [minimum, maximum] = sampleRange(samples, sampleAt(x), sampleAt(x + 1));
        context.moveTo(x + 0.5, (1 + minimum) * amplitude);
        context.lineTo(x + 0.5, (1 + Math.max(maximum, minimum + 1 / amplitude)) * amplitude);
      }
      context.stroke();
    }
    if (selectedCard) {
      drawHandle(context, fromX, height, color("--english-color"));
      drawHandle(context, untilX, height, color("--ruby-color"));
    }
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

  function setView(start, length) {
    const total = duration();
    const span = Math.min(total, Math.max(Math.min(minimumViewSeconds, total), length));
    const from = Math.max(0, Math.min(start, total - span));
    view = { start: from, end: from + span };
    updateControls();
    draw();
  }

  function zoom(factor) {
    const length = view.end - view.start;
    const middle = (selection.start + selection.end) / 2;
    const center = selectedCard && middle >= view.start && middle <= view.end
      ? middle : (view.start + view.end) / 2;
    const span = length / factor;
    setView(center - span / 2, span);
  }

  function revealSelection() {
    const length = view.end - view.start;
    if (selection.start >= view.start && selection.end <= view.end) return;
    if (selection.end - selection.start > length) {
      setView(selection.start, selection.end - selection.start);
    } else {
      setView(selection.start - (length - (selection.end - selection.start)) / 2, length);
    }
  }

  // Find where speech begins after `from`, skipping leading quiet audio.
  function findOnset(from) {
    const { buffer } = session;
    const samples = buffer.getChannelData(0);
    const windowSize = Math.max(1, Math.round(onsetWindowSeconds * buffer.sampleRate));
    const levels = [];
    let peak = 0;
    for (let offset = Math.floor(from * buffer.sampleRate); offset < samples.length; offset += windowSize) {
      const limit = Math.min(samples.length, offset + windowSize);
      let sum = 0;
      for (let index = offset; index < limit; index += 1) sum += samples[index] * samples[index];
      const level = Math.sqrt(sum / (limit - offset));
      levels.push(level);
      if (level > peak) peak = level;
    }
    const threshold = Math.max(onsetMinimumRms, peak * onsetPeakRatio);
    const first = levels.findIndex((level) => level >= threshold);
    if (first < 0) return from;
    return Math.max(from, from + first * onsetWindowSeconds - onsetLeadSeconds);
  }

  function showTrimView() {
    setView(selection.start - trimViewLeadSeconds, Math.max(trimViewSeconds, selection.end - selection.start + 2 * trimViewLeadSeconds));
  }

  function setSelection(start, end) {
    const total = duration();
    const from = Math.max(0, Math.min(start, total - minimumClipSeconds));
    selection = { start: from, end: Math.min(total, Math.max(end, from + minimumClipSeconds)) };
  }

  function selectCard(card) {
    if (!session || !card?.isConnected) return;
    stopPlayback();
    selectedCard = card;
    const id = api.cardId(card);
    const saved = session.clips.get(id);
    if (saved) {
      setSelection(saved.start, saved.end);
    } else {
      // Start where the closest earlier trimmed word ended, skip any quiet gap, and offer half a second.
      const cards = verseCards();
      const previous = cards.slice(0, cards.indexOf(card)).reverse()
        .map((candidate) => session.clips.get(api.cardId(candidate))).find(Boolean);
      const start = findOnset(previous ? previous.end : 0);
      setSelection(start, start + defaultClipSeconds);
    }
    showTrimView();
    updateControls();
    draw();
    const hint = api.hasRecording(card) ? " It already has audio; saving replaces it." : "";
    setStatus(`Trim the clip for “${cardLabel(card)}”.${hint}`, "ready");
  }

  function pointerTime(event) {
    const bounds = ui.canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return { time: view.start + ratio * (view.end - view.start), x: event.clientX - bounds.left, bounds };
  }

  function moveHandle(handle, time) {
    if (handle === "start") {
      selection.start = Math.max(0, Math.min(time, selection.end - minimumClipSeconds));
    } else {
      selection.end = Math.min(duration(), Math.max(time, selection.start + minimumClipSeconds));
    }
    updateControls();
    draw();
  }

  ui.canvas.addEventListener("pointerdown", (event) => {
    if (!session || !selectedCard || recording) return;
    const { time, x, bounds } = pointerTime(event);
    const toX = (value) => (value - view.start) / (view.end - view.start) * bounds.width;
    const startDistance = Math.abs(x - toX(selection.start));
    const endDistance = Math.abs(x - toX(selection.end));
    if (Math.min(startDistance, endDistance) <= handleTolerancePx) {
      activeHandle = startDistance <= endDistance ? "start" : "end";
    } else {
      activeHandle = time < (selection.start + selection.end) / 2 ? "start" : "end";
      moveHandle(activeHandle, time);
    }
    ui.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    if (!activeHandle || !session) return;
    moveHandle(activeHandle, pointerTime(event).time);
  });
  const releaseHandle = () => { activeHandle = null; };
  ui.canvas.addEventListener("pointerup", releaseHandle);
  ui.canvas.addEventListener("pointercancel", releaseHandle);

  function readTimeInput(input, handle) {
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) {
      updateControls();
      return;
    }
    moveHandle(handle, value);
    revealSelection();
  }

  ui.start.addEventListener("change", () => readTimeInput(ui.start, "start"));
  ui.end.addEventListener("change", () => readTimeInput(ui.end, "end"));
  ui.zoomIn.addEventListener("click", () => zoom(zoomFactor));
  ui.zoomOut.addEventListener("click", () => zoom(1 / zoomFactor));
  ui.zoomFit.addEventListener("click", () => setView(0, duration()));
  ui.pan.addEventListener("input", () => {
    const length = view.end - view.start;
    setView(Number(ui.pan.value) / 1000 * (duration() - length), length);
  });

  function cleanupCapture() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    analyser?.disconnect();
    analyser = null;
    liveSamples = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    captureContext?.close().catch(() => {});
    captureContext = null;
  }

  function setRecordingUi(active) {
    recording = active;
    ui.record.textContent = active ? "Stop" : "Record";
    ui.record.setAttribute("aria-label", active ? "Stop recording verse" : "Start recording verse");
    ui.record.setAttribute("aria-pressed", String(active));
  }

  function discardCapture() {
    generation += 1;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    mediaRecorder = null;
    cleanupCapture();
    setRecordingUi(false);
    processing = false;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus("Audio recording is not supported by this browser.", "error");
      return;
    }
    if (session?.clips.size && !window.confirm("Replace this verse recording? Clips already saved stay in the dictionary.")) return;
    const current = ++generation;
    const targetVerse = verse;
    stopPlayback();
    api.stopPlayback();
    processing = true;
    updateControls();
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation || !dialog.open) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = captured;
      const chunks = [];
      const recorder = new MediaRecorder(captured);
      mediaRecorder = recorder;
      captureContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = captureContext.createMediaStreamSource(captured);
      analyser = captureContext.createAnalyser();
      analyser.fftSize = 2048;
      liveSamples = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      await captureContext.resume();
      if (current !== generation) return;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        if (current !== generation) return;
        cleanupCapture();
        mediaRecorder = null;
        setRecordingUi(false);
        processing = true;
        updateControls();
        setStatus("Processing audio…", "processing");
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
          const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
          if (current !== generation) return;
          session = { buffer, clips: new Map() };
          sessions.set(verseKey(targetVerse), session);
          selectedCard = null;
          processing = false;
          setView(0, buffer.duration);
          api.refresh();
          const first = verseCards().find(hasText);
          if (first) selectCard(first);
          else setStatus("Verse recorded. Select a word to trim.", "ready");
        } catch {
          if (current !== generation) return;
          setStatus("Could not process this recording. Try recording again.", "error");
        } finally {
          if (current === generation) {
            processing = false;
            updateControls();
          }
        }
      }, { once: true });
      recorder.addEventListener("error", () => {
        if (current !== generation) return;
        discardCapture();
        updateControls();
        setStatus("Recording failed. Try recording again.", "error");
      }, { once: true });
      recorder.start();
      processing = false;
      setRecordingUi(true);
      updateControls();
      const drawLive = () => {
        if (!recording || current !== generation) return;
        draw();
        frame = requestAnimationFrame(drawLive);
      };
      drawLive();
      setStatus("Recording verse…", "recording");
    } catch {
      if (current !== generation) return;
      discardCapture();
      updateControls();
      setStatus("Microphone access was denied or is unavailable.", "error");
    } finally {
      if (current === generation && !recording) {
        processing = Boolean(mediaRecorder);
        updateControls();
      }
    }
  }

  function stopRecording() {
    if (!recording || !mediaRecorder) return;
    setRecordingUi(false);
    processing = true;
    updateControls();
    try {
      if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
    } finally {
      cleanupCapture();
    }
  }

  function clipBuffer() {
    const { buffer } = session;
    const startFrame = Math.floor(selection.start * buffer.sampleRate);
    const endFrame = Math.min(buffer.length, Math.ceil(selection.end * buffer.sampleRate));
    const frameCount = Math.max(1, endFrame - startFrame);
    const trimmed = audioContext.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      trimmed.copyToChannel(buffer.getChannelData(channel).subarray(startFrame, startFrame + frameCount), channel);
    }
    return trimmed;
  }

  function stopPlayback() {
    if (!playbackSource) return;
    playbackSource.onended = null;
    try { playbackSource.stop(); } catch { /* A source that failed to start has nothing to stop. */ }
    playbackSource.disconnect();
    playbackSource = null;
    ui.play.textContent = "Play clip";
  }

  async function playClip() {
    if (!session || !selectedCard) return;
    if (playbackSource) {
      stopPlayback();
      return;
    }
    try {
      api.stopPlayback();
      await audioContext.resume();
      const source = audioContext.createBufferSource();
      playbackSource = source;
      source.buffer = session.buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        source.disconnect();
        if (playbackSource !== source) return;
        playbackSource = null;
        ui.play.textContent = "Play clip";
      };
      source.start(0, selection.start, selection.end - selection.start);
      ui.play.textContent = "Stop";
    } catch {
      stopPlayback();
      setStatus("Unable to play this clip.", "error");
    }
  }

  async function saveClip() {
    if (!session || !selectedCard || saving) return;
    const card = selectedCard;
    const clip = { ...selection };
    const savedSession = session;
    saving = true;
    stopPlayback();
    updateControls();
    setStatus("Saving clip…", "processing");
    try {
      await api.saveClip(card, api.encodeWave(clipBuffer()), {
        verseReference: verse.dataset.verse,
        start: Number(clip.start.toFixed(3)),
        end: Number(clip.end.toFixed(3))
      });
      savedSession.clips.set(api.cardId(card), clip);
      if (session !== savedSession) return;
      const cards = verseCards();
      const next = cards.slice(cards.indexOf(card) + 1).find(hasText);
      saving = false;
      if (next) {
        selectCard(next);
        setStatus(`Saved “${cardLabel(card)}”. Now trimming “${cardLabel(next)}”.`, "ready");
      } else {
        updateControls();
        draw();
        setStatus(`Saved “${cardLabel(card)}”. All words in this verse have been visited.`, "ready");
      }
    } catch {
      setStatus("Could not save the clip. Check browser storage and try again.", "error");
    } finally {
      saving = false;
      updateControls();
    }
  }

  ui.record.addEventListener("click", () => (recording ? stopRecording() : startRecording()));
  ui.play.addEventListener("click", playClip);
  ui.save.addEventListener("click", saveClip);
  ui.close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    discardCapture();
    stopPlayback();
    activeHandle = null;
    api.refresh();
    trigger?.focus();
  });
  window.addEventListener("resize", () => { if (dialog.open) resizeCanvas(); });
  window.addEventListener("pagehide", () => {
    discardCapture();
    stopPlayback();
  });
  new MutationObserver(() => {
    if (dialog.open) draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function open(targetVerse, button) {
    document.dispatchEvent(new Event("workspaceediting"));
    trigger = button;
    const changed = verse !== targetVerse;
    if (changed) {
      stopPlayback();
      selectedCard = null;
    }
    verse = targetVerse;
    session = sessions.get(verseKey(verse)) || null;
    if (selectedCard && !selectedCard.isConnected) selectedCard = null;
    if (session && (changed || !selectedCard)) {
      selection = { start: 0, end: 0 };
      view = { start: 0, end: session.buffer.duration };
    }
    const language = verse.lang === "yue" ? "Cantonese" : verse.lang === "en" ? "English" : verse.lang;
    ui.title.textContent = `Record ${verse.dataset.verse}`;
    ui.context.textContent = `${verse.dataset.verse} · ${language}`;
    if (!session) {
      selection = { start: 0, end: 0 };
      view = { start: 0, end: 0 };
    }
    renderWords();
    if (!dialog.open) dialog.showModal();
    resizeCanvas();
    updateControls();
    setStatus(session ? "Select a word to trim its clip." : "Record the whole verse to begin.", "ready");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".record-verse, .trim-verse");
    const targetVerse = button?.closest(".verse");
    if (targetVerse) open(targetVerse, button);
  });
  document.addEventListener("cardschanged", () => {
    if (dialog.open) renderWords();
  });

  return {
    refresh() {
      if (dialog.open) updateWordStates();
    },
    hasSession(element) {
      return sessions.has(verseKey(element));
    }
  };
}
