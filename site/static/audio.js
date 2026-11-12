// Audio workflow page: language -> sample verses -> grammar -> books -> export. Everything stays in the browser.
import { chunkWords, learnRules } from "./grammar-order.js";
import { makeZip, readZip } from "./lift-exchange.js";
import {
  steps, isProperNoun, isUnspoken, unspokenKey, bookCards, chapterOrder, nextBook, verseStatus, playbackLemmas, playbackWords, groupVerses, toToken, buildExportParts, parseManifest
} from "./audio-workflow.js";
import * as store from "./audio-store.js";
const { transliterateGreek } = globalThis.MaculaGreek;
import { synthesizeGreek } from "./greek-tts.js";
import { resynthesize, resynthError } from "./neural-resynth.js";
import { compressSamples, decodeBlob, encodeWav, extensionForType, joinSamples, peakNormalize, trimSilence, verseSampleRate } from "./verse-audio.js";

const root = document.querySelector("#audio");
const $ = (selector) => document.querySelector(selector);
const secondsPerCard = 2.7;
const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

function el(tag, text, props = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  Object.assign(node, props);
  return node;
}

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

let state;
let clips;
let plan = null;
let step = "language";
const bookCache = new Map();

// ---- Playback -------------------------------------------------------------------------------------------------

const player = new Audio();
let playToken = 0;

function stopPlayback() {
  playToken += 1;
  player.pause();
}

// Plays blobs in turn. A caller that already claimed a playback slot (stopPlayback, then playToken) passes its token.
async function playBlobs(blobs, onStart, claimed) {
  if (claimed === undefined) stopPlayback();
  else player.pause();
  const token = claimed ?? playToken;
  for (const [index, blob] of blobs.entries()) {
    if (token !== playToken) return;
    const url = URL.createObjectURL(blob);
    try {
      player.src = url;
      await player.play();
      onStart?.(index);
      await new Promise((resolve) => {
        player.onended = resolve;
        player.onpause = resolve;
        player.onerror = resolve;
      });
    } catch (error) {
      console.warn("Playback failed", error);
      return;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// Plays a word's recording, or the eSpeak-NG reading of `text` when it has none.
async function playWord(lemma, text) {
  stopPlayback();
  const token = playToken;
  const blob = clips.get(lemma)?.blob ?? await synthesizeGreek(text);
  if (blob && token === playToken) await playBlobs([blob], undefined, token);
}
const canPlayWord = (lemma) => clips.has(lemma) || state.autoVoice;

// ---- Whole-verse audio ----------------------------------------------------------------------------------------

// Builds one signal for a verse in its playback order: recordings, with a computer voice for unrecorded words, then
// optional neural resynthesis. Resolves to null when stopped (token changed) or when there is nothing to play.
async function verseAudio(words, order, token, report) {
  const parts = [];
  let synthesized = 0;
  let skipped = 0;
  for (const word of playbackWords(words, state.rules, order, state.unspoken)) {
    let blob = clips.get(word.lemma)?.blob;
    if (!blob && state.autoVoice) {
      report(`Reading “${word.surface}”…`);
      blob = await synthesizeGreek(word.surface);
      if (blob) synthesized += 1;
    }
    if (token !== playToken) return null;
    if (!blob) {
      skipped += 1;
      continue;
    }
    try {
      parts.push(trimSilence(peakNormalize(await decodeBlob(blob))));
    } catch {
      skipped += 1;
    }
    if (token !== playToken) return null;
  }
  if (!parts.length) {
    report("There is no audio for this verse yet. Record some of its words.");
    return null;
  }
  let samples = joinSamples(parts);
  const notes = [];
  if (state.neuralAudio) {
    report("Smoothing the verse with neural resynthesis…");
    const smoothed = await resynthesize(samples);
    if (token !== playToken) return null;
    if (smoothed) samples = peakNormalize(smoothed);
    else notes.push(`Neural smoothing is off for this play (${resynthError() || "unavailable"}); the original audio was used. You can turn it off in Settings.`);
  }
  if (synthesized) notes.push(`${synthesized} word${synthesized === 1 ? " was" : "s were"} read by computer voice.`);
  if (skipped) notes.push(`${skipped} word${skipped === 1 ? " was" : "s were"} skipped (no recording).`);
  report(notes.join(" "));
  return { samples, rate: verseSampleRate };
}

function setPlaying(button, playing) {
  button.dataset.idle ??= button.textContent;
  button.classList.toggle("playing", playing);
  if (playing) button.replaceChildren(el("span", undefined, { className: "stop-icon", ariaHidden: "true" }), " Stop");
  else button.textContent = button.dataset.idle;
}

// The button stays a play button while the verse is prepared and becomes Stop once audio starts; pressing it while
// busy or playing stops.
async function playVerse(verse, order, button, report) {
  if (button.dataset.busy) {
    stopPlayback();
    return;
  }
  stopPlayback();
  const token = playToken;
  button.dataset.busy = "true";
  try {
    const result = await verseAudio(verse.words, order, token, report);
    if (result && token === playToken) await playBlobs([encodeWav(result.samples, result.rate)], () => setPlaying(button, true), token);
  } catch (error) {
    report(`Could not play: ${error.message}`);
  } finally {
    delete button.dataset.busy;
    setPlaying(button, false);
  }
}

async function downloadVerse(verse, order, button, report) {
  const idle = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing…";
  stopPlayback();
  try {
    const result = await verseAudio(verse.words, order, playToken, report);
    if (!result) return;
    report("Compressing…");
    const blob = await compressSamples(result.samples, result.rate);
    download(blob, `${slug()}-${verse.verse.replace(/[^\p{L}\p{N}]+/gu, "-")}.${extensionForType(blob.type)}`);
    report(`Downloaded ${verse.verse} (${Math.ceil(blob.size / 1024)} KB).`);
  } catch (error) {
    report(`Could not download: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = idle;
  }
}

// ---- Microphone capture ---------------------------------------------------------------------------------------

let stream = null;
let mediaRecorder = null;
let pieces = [];
let capturing = false;

async function startCapture() {
  stopPlayback();
  stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  pieces = [];
  mediaRecorder.ondataavailable = (event) => { if (event.data.size) pieces.push(event.data); };
  mediaRecorder.start();
}

function stopCapture() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => resolve(new Blob(pieces, { type: mediaRecorder.mimeType }));
    mediaRecorder.stop();
  });
}

function releaseMicrophone() {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  mediaRecorder = null;
  capturing = false;
  activeRecorder?.render();
}

// ---- Press-and-hold recording ---------------------------------------------------------------------------------

// Recording runs while `node` (or Space/Enter on it) is held down and is saved under `lemma()` on release.
// onState(message) reports progress; onSaved(lemma) runs after a clip was stored.
function attachHold(node, { lemma, onState, onSaved }) {
  let recording = false;
  let holding = false;
  let pending = null;
  let target = null;
  let settling = false;
  let discard = false;

  async function finish() {
    try {
      const blob = await stopCapture();
      recording = false;
      if (discard) {
        onState("Cancelled: you let go far from the button, so nothing was saved.");
      } else if (blob.size) {
        const saved = Date.now();
        await store.saveClip(target, blob);
        clips.set(target, { blob, mime: blob.type, saved });
        onState(`Saved “${target}”.`);
        onSaved(target);
      } else {
        onState("Nothing was recorded. Hold the button a little longer.");
      }
    } catch (error) {
      recording = false;
      onState(`Could not save: ${error.message}`);
    }
  }

  async function press() {
    const wanted = lemma();
    if (holding || recording || !wanted || capturing) return;
    holding = true;
    capturing = true;
    discard = false;
    target = wanted;
    pending = (async () => {
      try {
        await startCapture();
        recording = true;
        node.classList.add("recording");
        onState("Recording…");
      } catch (error) {
        recording = false;
        holding = false;
        capturing = false;
        node.classList.remove("recording");
        onState(`Microphone unavailable: ${error.message}`);
      }
    })();
    await pending;
    if (!holding) await settle();
  }

  // Stops and saves once, whether the button was released during or after the microphone start-up.
  async function settle() {
    if (!recording || settling) return;
    settling = true;
    node.classList.remove("recording");
    await finish();
    capturing = false;
    settling = false;
  }

  // Letting go more than twice the button's size away from its centre cancels the take.
  const farAway = (event) => {
    if (event?.type !== "pointerup") return false;
    const box = node.getBoundingClientRect();
    return Math.hypot(event.clientX - (box.left + box.width / 2), event.clientY - (box.top + box.height / 2)) > 2 * Math.max(box.width, box.height);
  };

  async function release(event) {
    if (!holding) return;
    holding = false;
    discard = farAway(event);
    await pending;
    await settle();
  }

  node.addEventListener("pointerdown", (event) => {
    if (event.button) return;
    event.preventDefault();
    node.setPointerCapture?.(event.pointerId);
    press();
  });
  for (const type of ["pointerup", "pointercancel"]) node.addEventListener(type, release);
  node.addEventListener("contextmenu", (event) => event.preventDefault());
  node.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) press();
  });
  node.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") release(event);
  });
  return { press, release, get recording() { return recording; }, reset() { recording = false; holding = false; capturing = false; node.classList.remove("recording"); } };
}

// ---- Card recorder (one card at a time) -----------------------------------------------------------------------

let activeRecorder = null;

function createRecorder(container, onSaved) {
  let cards = [];
  let details = new Map();
  let index = 0;
  let message = "";
  const parts = {
    count: el("p", undefined, { className: "recorder-count" }),
    greek: el("p", undefined, { className: "recorder-greek", lang: "grc" }),
    gloss: el("p", undefined, { className: "recorder-gloss" }),
    details: el("p", undefined, { className: "card-details" }),
    note: el("p", undefined, { className: "recorder-note" }),
    status: el("p", undefined, { className: "recorder-status", role: "status" })
  };
  const button = (label, name, handler) => {
    const node = el("button", label, { type: "button", ariaLabel: name, title: name });
    if (handler) node.addEventListener("click", handler);
    return node;
  };
  const previous = button("\u23EE\uFE0E", "Previous card", () => move(-1));
  const record = button("\u25CF", "Hold to record, release to stop");
  record.classList.add("record-hold");
  const play = button("\u25B6", "Play recording, or the computer voice if none", () => playWord(cards[index].greek, cards[index].greek));
  const next = button("\u23ED\uFE0E", "Next card", () => move(1));
  const actions = el("div", undefined, { className: "recorder-actions" });
  actions.append(previous, record, play, next);
  container.replaceChildren(parts.count, parts.greek, parts.gloss, parts.details, parts.note, actions, parts.status);

  const missingFrom = (from) => {
    for (let offset = 1; offset <= cards.length; offset += 1) {
      const candidate = (from + offset) % cards.length;
      if (!clips.has(cards[candidate].greek)) return candidate;
    }
    return -1;
  };

  function render() {
    const card = cards[index];
    container.hidden = !card;
    if (!card) return;
    const recording = hold.recording;
    const recorded = cards.filter((item) => clips.has(item.greek)).length;
    const left = cards.length - recorded;
    parts.count.textContent = `Card ${index + 1} of ${cards.length} · ${recorded} recorded · about ${Math.ceil(left * secondsPerCard / 60)} min left`;
    parts.greek.textContent = card.greek;
    parts.gloss.textContent = card.gloss && card.gloss !== "-" ? `“${card.gloss}”` : "";
    const detail = details.get(card.greek);
    parts.details.replaceChildren(...[
      ["English", card.gloss && card.gloss !== "-" ? card.gloss : detail?.gloss],
      ["Mandarin", detail?.mandarin],
      ["Transliteration", transliterateGreek(card.greek)],
      ["Class", detail?.pos],
      ["Morph", detail?.morph]
    ].filter(([, value]) => value && value !== "-").map(([label, value]) => el("span", `${label}: ${value}`)));
    parts.note.textContent = card.verses ? `Used in ${card.verses.join(", ")}` : "";
    record.classList.toggle("has-clip", clips.has(card.greek));
    record.title = clips.has(card.greek) ? "Hold to re-record, release to stop" : "Hold to record, release to stop";
    record.setAttribute("aria-pressed", String(recording));
    play.disabled = recording || !canPlayWord(card.greek);
    previous.disabled = recording || index === 0;
    next.disabled = recording || index === cards.length - 1;
    parts.status.textContent = message || (left === 0 ? "All cards recorded." : "Hold ● (or Space) while you say the word, then let go.");
  }

  function move(delta) {
    index = Math.max(0, Math.min(cards.length - 1, index + delta));
    message = "";
    render();
  }

  // Previous/Next step one card; only a finished recording jumps ahead to the next card without a clip.
  const hold = attachHold(record, {
    lemma: () => cards[index]?.greek,
    onState(text) {
      message = text;
      render();
    },
    onSaved() {
      const upcoming = missingFrom(index);
      if (upcoming >= 0) index = upcoming;
      onSaved();
      render();
    }
  });

  return {
    render,
    press: hold.press,
    release: hold.release,
    setCards(list, lemmaDetails = new Map()) {
      cards = list;
      details = lemmaDetails;
      hold.reset();
      message = "";
      const first = cards.findIndex((card) => !clips.has(card.greek));
      index = first >= 0 ? first : 0;
      render();
    }
  };
}

document.addEventListener("keydown", (event) => {
  if (event.key !== " " || !activeRecorder || document.querySelector("dialog[open]") || event.target.closest("input, select, textarea, button, a, summary")) return;
  event.preventDefault();
  if (!event.repeat) activeRecorder.press();
});
document.addEventListener("keyup", (event) => {
  if (event.key === " " && activeRecorder) activeRecorder.release();
});

// ---- Progress and breadcrumbs ---------------------------------------------------------------------------------

const done = {
  language: () => Boolean(state.language.trim()),
  books: () => Boolean(plan) && plan.cards.every((card) => state.unspoken[card.greek] || clips.has(card.greek)),
  export: () => false,
  settings: () => false
};

function renderCrumbs() {
  $("#crumbs").replaceChildren(...steps.map(({ id, label }, number) => {
    const item = el("li", undefined, { className: done[id]() ? "done" : "" });
    const link = el("a", `${number + 1}. ${label}${done[id]() ? " ✓" : ""}`, { href: `#${id}` });
    if (id === step) link.setAttribute("aria-current", "step");
    item.append(link);
    return item;
  }));
}

function saveSoon() {
  return store.saveState(state);
}

// ---- Listen panel ---------------------------------------------------------------------------------------------

async function bookVerses(code) {
  if (!bookCache.has(code)) {
    try {
      const rows = await fetchJson(`${root.dataset.books}${code}.json`);
      bookCache.set(code, groupVerses(rows.map(toToken)));
    } catch {
      bookCache.set(code, []);
    }
  }
  return bookCache.get(code);
}

const chapterOf = (verse) => Number(verse.split(" ")[1].split(":")[0]);

async function renderListen() {
  const section = $("#listen");
  section.hidden = step !== "books";
  if (section.hidden) return;
  const chapterSelect = $("#listen-chapter");
  let verses = await bookVerses($("#book-select").value);
  const chapters = [...new Set(verses.map((verse) => chapterOf(verse.verse)))];
  const previous = chapterSelect.value;
  chapterSelect.replaceChildren(...chapters.map((chapter) => el("option", `Chapter ${chapter}`, { value: String(chapter) })));
  if (chapters.includes(Number(previous))) chapterSelect.value = previous;
  else {
    const firstReady = chapters.find((chapter) => verses.some((verse) => chapterOf(verse.verse) === chapter && verseStatus(verse.words, clips, state.unspoken).complete));
    chapterSelect.value = String(firstReady ?? chapters[0] ?? "");
  }
  verses = verses.filter((verse) => String(chapterOf(verse.verse)) === chapterSelect.value);
  const onlyComplete = $("#listen-complete").checked;
  const ready = verses.filter((verse) => verseStatus(verse.words, clips, state.unspoken).complete);
  $("#listen-summary").textContent = verses.length
    ? `${ready.length} of ${verses.length} verses are fully recorded.`
    : "This build has no verses for this selection.";
  $("#listen-list").replaceChildren(...(onlyComplete ? ready : verses).map((verse) => {
    const status = verseStatus(verse.words, clips, state.unspoken);
    const item = el("li", undefined, { className: status.complete ? "" : "incomplete" });
    const lemmas = playbackLemmas(verse.words, state.rules, state.seedOrders[verse.verse], state.unspoken);
    const play = el("button", `▶ ${verse.verse}`, { type: "button", className: "verse-play", disabled: !lemmas.length });
    const report = (text) => { $("#listen-summary").textContent = text; };
    play.addEventListener("click", () => {
      item.classList.add("playing");
      playVerse(verse, state.seedOrders[verse.verse], play, report).finally(() => item.classList.remove("playing"));
    });
    const save = el("button", "\u2B07", { type: "button", ariaLabel: `Download ${verse.verse}`, title: "Download this verse as compressed audio", disabled: !lemmas.length });
    save.addEventListener("click", () => downloadVerse(verse, state.seedOrders[verse.verse], save, report));
    const english = playbackWords(verse.words, state.rules, state.seedOrders[verse.verse], state.unspoken).map((word) => word.gloss).filter((gloss) => gloss && gloss !== "-").join(" ");
    item.append(play, save, el("span", verse.words.map((word) => word.surface).join(" "), { lang: "grc", className: "listen-greek" }),
      el("small", `${english}${status.complete ? "" : ` · ${status.missing.length} word(s) still to record${state.autoVoice ? " (read by computer voice meanwhile)" : ""}`}`, { className: "listen-order" }));
    openOnHold(item, () => openGrammar(verse));
    return item;
  }));
}

// ---- Steps ----------------------------------------------------------------------------------------------------

let bookRecorder;

// Double-click or long-press (not on a button) opens the grammar dialog for a verse.
function openOnHold(item, open) {
  let timer = 0;
  const cancel = () => clearTimeout(timer);
  item.addEventListener("dblclick", (event) => {
    if (!event.target.closest("button")) open();
  });
  item.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    timer = setTimeout(open, 600);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave", "pointermove"]) item.addEventListener(type, cancel);
  item.addEventListener("contextmenu", (event) => event.preventDefault());
}

function renderBooks() {
  const select = $("#book-select");
  if (!plan) {
    $("#book-progress").textContent = "The recording plan could not be loaded.";
    return;
  }
  const preferred = select.value || state.book || nextBook(plan, clips, state.unspoken);
  select.replaceChildren(...plan.stages.map((stage) => {
    const cards = bookCards(plan, stage.book, state.unspoken);
    const recorded = cards.filter((card) => clips.has(card.greek)).length;
    return el("option", `${stage.book} · ${recorded}/${cards.length} cards`, { value: stage.book });
  }));
  select.value = preferred;
  showBook();
}

async function showBook() {
  const code = $("#book-select").value;
  state.book = code;
  saveSoon();
  const verses = await bookVerses(code);
  if (code !== $("#book-select").value) return;
  const cards = chapterOrder(bookCards(plan, code, state.unspoken), verses);
  const left = cards.filter((card) => !clips.has(card.greek)).length;
  $("#book-progress").textContent = cards.length
    ? `${left} of ${cards.length} cards left for ${code}, about ${Math.ceil(left * secondsPerCard / 60)} minutes. Words already recorded in earlier books are skipped.`
    : `${code} needs no new cards.`;
  const details = new Map();
  for (const verse of verses) for (const word of verse.words) if (!details.has(word.lemma)) details.set(word.lemma, word);
  bookRecorder.setCards(cards, details);
  activeRecorder = bookRecorder;
  renderListen();
}

// ---- Grammar dialog (opened from a verse in the listen panel) -------------------------------------------------

let grammarMode = "order";

async function rebuildRules() {
  const examples = [];
  for (const [verse, order] of Object.entries(state.seedOrders)) {
    const found = (await bookVerses(verse.split(" ")[0])).find((item) => item.verse === verse);
    if (found) examples.push({ chunks: chunkWords(found.words), order });
  }
  state.rules = learnRules(examples);
  saveSoon();
}

function openGrammar(verse) {
  const dialog = $("#grammar-dialog");
  const chunks = chunkWords(verse.words);
  let order = state.seedOrders[verse.verse] ?? chunks.map((_, index) => index);
  const list = $("#grammar-chunks");
  const status = $("#grammar-status");
  $("#grammar-title").textContent = verse.verse;

  const commit = async () => {
    state.seedOrders[verse.verse] = order.slice();
    await rebuildRules();
    draw();
  };
  const move = (from, to) => {
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    commit();
  };
  const setUnspoken = (words, off) => {
    for (const word of words) {
      if (off) state.unspoken[unspokenKey(word)] = true;
      else delete state.unspoken[unspokenKey(word)];
    }
    saveSoon();
    renderAfterChange();
    draw();
  };
  const iconButton = (label, name, className, handler) => {
    const node = el("button", label, { type: "button", ariaLabel: name, title: name, className });
    if (handler) node.addEventListener("click", handler);
    return node;
  };

  function draw() {
    for (const input of document.querySelectorAll('input[name="grammar-mode"]')) input.checked = input.value === grammarMode;
    $("#grammar-confirm").hidden = $("#grammar-reset").hidden = grammarMode !== "order";
    status.textContent = grammarMode === "order"
      ? (state.seedOrders[verse.verse] ? "✓ Order saved" : "Drag the chunks into your language's order.")
      : "Hold ● to record a word, ▶ to hear it.";
    const nothingToPlay = !playbackWords(verse.words, state.rules, order, state.unspoken).length;
    $("#grammar-play-verse").disabled = $("#grammar-download").disabled = nothingToPlay;
    if (grammarMode === "playback") {
      list.replaceChildren(...order.flatMap((chunkIndex) => chunks[chunkIndex].words).filter((word) => !isProperNoun(word) && !isUnspoken(word, state.unspoken)).map((word) => {
        const item = el("li", undefined, { className: "grammar-chunk grammar-word-row" });
        const record = iconButton("\u25CF", `Hold to record ${word.surface}`, `chunk-side record-hold${clips.has(word.lemma) ? " has-clip" : ""}`);
        attachHold(record, {
          lemma: () => word.lemma,
          onState: (text) => { status.textContent = text; },
          onSaved: () => { renderAfterChange(); draw(); }
        });
        const play = iconButton("\u25B6", `Play ${word.surface}`, "chunk-side", () => playWord(word.lemma, word.surface));
        play.disabled = !canPlayWord(word.lemma);
        const body = el("div", undefined, { className: "grammar-body" });
        body.append(el("span", word.surface, { lang: "grc", className: "grammar-words" }), el("small", word.gloss && word.gloss !== "-" ? word.gloss : ""));
        item.append(record, body, play);
        return item;
      }));
      return;
    }
    list.replaceChildren(...order.map((chunkIndex, position) => {
      const chunk = chunks[chunkIndex];
      const item = el("li", undefined, { draggable: true, className: "grammar-chunk" });
      const speakable = chunk.words.filter((word) => !isProperNoun(word));
      const allOff = speakable.length > 0 && speakable.every((word) => isUnspoken(word, state.unspoken));
      item.classList.toggle("unspoken", allOff);
      if (speakable.length) {
        const card = iconButton("\u2205", allOff ? "Speak every word in this card" : "Leave out every word in this card", "unspoken-card",
          () => setUnspoken(speakable, !allOff));
        card.setAttribute("aria-pressed", String(allOff));
        item.append(card);
      }
      const wordList = el("span", undefined, { lang: "grc", className: "grammar-words" });
      for (const word of chunk.words) {
        const off = isUnspoken(word, state.unspoken);
        const wordNode = el("span", undefined, { className: off ? "grammar-word unspoken" : "grammar-word" });
        wordNode.append(el("span", word.surface));
        if (speakable.length > 1 && !isProperNoun(word)) {
          const toggle = iconButton("\u2205", off ? `Speak ${word.surface}` : `Leave out ${word.surface}`, "unspoken-word", () => setUnspoken([word], !off));
          toggle.setAttribute("aria-pressed", String(off));
          wordNode.append(toggle);
        }
        wordList.append(wordNode);
      }
      const left = iconButton("←", "Move earlier", "chunk-side", () => move(position, position - 1));
      const right = iconButton("→", "Move later", "chunk-side", () => move(position, position + 1));
      left.disabled = position === 0;
      right.disabled = position === order.length - 1;
      const body = el("div", undefined, { className: "grammar-body" });
      body.append(wordList, el("small", chunk.words.map((word) => word.gloss).filter(Boolean).join(" ")), el("small", chunk.slot, { className: "grammar-slot" }));
      item.append(left, body, right);
      {
        item.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(position)));
        item.addEventListener("dragover", (event) => event.preventDefault());
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          move(Number(event.dataTransfer.getData("text/plain")), position);
        });
      }
      return item;
    }));
  }

  const report = (text) => { status.textContent = text; };
  $("#grammar-play-verse").onclick = () => playVerse(verse, order, $("#grammar-play-verse"), report);
  $("#grammar-download").onclick = () => downloadVerse(verse, order, $("#grammar-download"), report);
  $("#grammar-close").onclick = () => dialog.close();
  $("#grammar-confirm").onclick = commit;
  $("#grammar-reset").onclick = async () => {
    order = chunks.map((_, index) => index);
    delete state.seedOrders[verse.verse];
    await rebuildRules();
    draw();
  };
  for (const input of document.querySelectorAll('input[name="grammar-mode"]')) {
    input.onchange = () => {
      grammarMode = input.value;
      draw();
    };
  }
  dialog.onclose = () => {
    stopPlayback();
    renderAfterChange();
  };
  draw();
  if (!dialog.open) dialog.showModal();
}

function renderAfterChange() {
  renderCrumbs();
  renderListen();
  if (step === "books" && plan) {
    const option = $("#book-select").selectedOptions[0];
    const cards = bookCards(plan, $("#book-select").value, state.unspoken);
    if (option) option.textContent = `${option.value} · ${cards.filter((card) => clips.has(card.greek)).length}/${cards.length} cards`;
  }
}

// ---- Settings: recorded words and data reset -------------------------------------------------------------------

const pageSize = 20;
let settingsPage = 0;

function renderSettings() {
  const glosses = new Map((plan?.cards ?? []).map((card) => [card.greek, card.gloss]));
  const query = $("#word-search").value.trim().toLowerCase();
  const rows = [...clips].map(([lemma, clip]) => ({ lemma, gloss: glosses.get(lemma) ?? "", saved: clip.saved ?? 0 }))
    .filter((row) => !query || row.lemma.toLowerCase().includes(query) || row.gloss.toLowerCase().includes(query))
    .sort((a, b) => a.saved - b.saved || a.lemma.localeCompare(b.lemma));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  settingsPage = Math.min(settingsPage, pages - 1);
  $("#word-summary").textContent = `${rows.length} recorded word${rows.length === 1 ? "" : "s"}, oldest first.`;
  $("#word-page").textContent = `Page ${settingsPage + 1} of ${pages}`;
  $("#word-prev").disabled = settingsPage === 0;
  $("#word-next").disabled = settingsPage >= pages - 1;
  const message = $("#word-status");
  $("#word-list").replaceChildren(...rows.slice(settingsPage * pageSize, (settingsPage + 1) * pageSize).map((row) => {
    const item = el("li", undefined, { className: "word-row" });
    const play = el("button", "\u25B6", { type: "button", ariaLabel: `Play ${row.lemma}`, title: "Play recording" });
    play.addEventListener("click", () => playBlobs([clips.get(row.lemma).blob]));
    const record = el("button", "\u25CF", { type: "button", ariaLabel: `Hold to re-record ${row.lemma}`, title: "Hold to re-record, release to stop", className: "record-hold has-clip" });
    attachHold(record, {
      lemma: () => row.lemma,
      onState: (text) => { message.textContent = text; },
      onSaved: () => renderSettings()
    });
    item.dataset.saved = `Recorded ${row.saved ? new Date(row.saved).toLocaleString() : "at an unknown time"}`;
    const actions = el("span", undefined, { className: "word-actions" });
    actions.append(record, play);
    item.append(el("span", row.lemma, { lang: "grc", className: "word-greek" }), el("span", row.gloss ? `“${row.gloss}”` : "", { className: "word-gloss" }), actions);
    return item;
  }));
}

async function clearEverything() {
  if (!confirm("Delete ALL recordings, language settings, grammar orders, cookies and cached files from this browser? This cannot be undone.")) return;
  if (!confirm("Last chance: everything saved on this device will be erased. Export first if you still need it. Continue?")) return;
  const status = $("#clear-status");
  try {
    await store.wipe();
    localStorage.clear();
    sessionStorage.clear();
    for (const name of await caches.keys()) await caches.delete(name);
    for (const registration of await navigator.serviceWorker?.getRegistrations() ?? []) await registration.unregister();
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
    status.textContent = "Everything was deleted. Reloading…";
    location.hash = "";
    location.reload();
  } catch (error) {
    status.textContent = `Could not clear everything: ${error.message}`;
  }
}

function renderExport() {
  const recorded = clips.size;
  $("#export-summary").textContent = `${recorded} recorded word${recorded === 1 ? "" : "s"} in ${state.language.trim() || "your language"}, `
    + `${Object.keys(state.rules).length} grammar rules.`;
  $("#export-button").disabled = recorded === 0;
}

const slug = () => (state.language.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "audio");

function download(blob, name) {
  const link = el("a", undefined, { href: URL.createObjectURL(blob), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function exportAll() {
  const status = $("#export-status");
  try {
    const parts = buildExportParts({ language: state.language, rules: state.rules, seedOrders: state.seedOrders, unspoken: state.unspoken, clips });
    for (const [index, part] of parts.entries()) {
      const files = new Map(part.files);
      files.set("manifest.json", new Blob([JSON.stringify(part.manifest, null, 1)], { type: "application/json" }));
      download(await makeZip(files), `macula-${slug()}${parts.length > 1 ? `-part${index + 1}` : ""}.zip`);
    }
    status.textContent = `Exported ${clips.size} words in ${parts.length} ZIP file${parts.length === 1 ? "" : "s"}.`;
  } catch (error) {
    status.textContent = `Export failed: ${error.message}`;
  }
}

async function importFiles(files) {
  const status = $("#export-status");
  let added = 0;
  let skipped = 0;
  try {
    for (const file of files) {
      const archive = await readZip(file);
      const manifestFile = archive.get("manifest.json");
      if (!manifestFile) throw new Error(`${file.name} has no manifest.json.`);
      const manifest = parseManifest(await manifestFile.text());
      for (const clip of manifest.clips) {
        const blob = archive.get(clip.file);
        if (!blob || !clip.mime.startsWith("audio/") || clips.has(clip.lemma)) {
          skipped += 1;
          continue;
        }
        const typed = new Blob([blob], { type: clip.mime });
        await store.saveClip(clip.lemma, typed);
        clips.set(clip.lemma, { blob: typed, mime: clip.mime, saved: Date.now() });
        added += 1;
      }
      if (!state.language.trim()) state.language = manifest.language;
      if (!Object.keys(state.seedOrders).length) {
        state.seedOrders = manifest.seedOrders;
        state.rules = manifest.rules;
      }
      state.unspoken = { ...manifest.unspoken, ...state.unspoken };
    }
    await saveSoon();
    status.textContent = `Imported ${added} new words; ${skipped} skipped (already recorded or unusable).`;
    $("#language-name").value = state.language;
  } catch (error) {
    status.textContent = `Import failed: ${error.message}`;
  }
  renderExport();
  renderCrumbs();
}

// ---- Routing --------------------------------------------------------------------------------------------------

function firstIncomplete() {
  return steps.slice(0, -1).find(({ id }) => !done[id]())?.id ?? "export";
}

function route() {
  const requested = location.hash.slice(1);
  step = steps.some(({ id }) => id === requested) ? requested : firstIncomplete();
  stopPlayback();
  releaseMicrophone();
  activeRecorder = null;
  for (const { id } of steps) $(`#step-${id}`).hidden = id !== step;
  renderCrumbs();
  if (step === "language") $("#language-name").focus();
  if (step === "books") renderBooks();
  if (step === "export") renderExport();
  if (step === "settings") renderSettings();
  renderListen();
}

async function initialize() {
  [state, clips] = await Promise.all([store.loadState(), store.loadClips()]);
  plan = await fetchJson(root.dataset.plan).catch(() => null);
  bookRecorder = createRecorder($("#book-recorder"), () => {
    renderCrumbs();
    renderListen();
    const option = $("#book-select").selectedOptions[0];
    const cards = bookCards(plan, $("#book-select").value, state.unspoken);
    option.textContent = `${option.value} · ${cards.filter((card) => clips.has(card.greek)).length}/${cards.length} cards`;
  });
  const languageInput = $("#language-name");
  languageInput.value = state.language;
  languageInput.addEventListener("input", () => {
    state.language = languageInput.value;
    saveSoon();
    renderCrumbs();
  });
  for (const [id, key] of [["#setting-neural", "neuralAudio"], ["#setting-voice", "autoVoice"]]) {
    const box = $(id);
    box.checked = state[key];
    box.addEventListener("change", () => {
      state[key] = box.checked;
      saveSoon();
    });
  }
  // Enter in the language box opens John 1:1 in the verse dialog's playback mode, so it can be heard and recorded
  // before any book is started.
  languageInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || !languageInput.value.trim()) return;
    event.preventDefault();
    const verse = (await bookVerses("JHN")).find((item) => item.verse === "JHN 1:1");
    if (!verse) return;
    grammarMode = "playback";
    openGrammar(verse);
  });
  $("#book-select").addEventListener("change", showBook);
  $("#listen-chapter").addEventListener("change", renderListen);
  $("#listen-complete").addEventListener("change", renderListen);
  $("#listen-stop").addEventListener("click", stopPlayback);
  $("#export-button").addEventListener("click", exportAll);
  $("#word-search").addEventListener("input", () => {
    settingsPage = 0;
    renderSettings();
  });
  $("#word-prev").addEventListener("click", () => {
    settingsPage -= 1;
    renderSettings();
  });
  $("#word-next").addEventListener("click", () => {
    settingsPage += 1;
    renderSettings();
  });
  $("#clear-all").addEventListener("click", clearEverything);
  $("#import-file").addEventListener("change", (event) => {
    importFiles([...event.target.files]);
    event.target.value = "";
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("pagehide", releaseMicrophone);
  $("#audio-status").hidden = true;
  route();
}

initialize().catch((error) => {
  $("#audio-status").textContent = `Could not start: ${error.message}`;
});
