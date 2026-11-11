// Audio workflow page: language -> sample verses -> grammar -> books -> export. Everything stays in the browser.
import { chunkWords, learnRules } from "./grammar-order.js";
import { makeZip, readZip } from "./lift-exchange.js";
import {
  steps, seedCards, isProperNoun, bookCards, chapterOrder, nextBook, verseStatus, playbackLemmas, groupVerses, toToken, buildExportParts, parseManifest
} from "./audio-workflow.js";
import * as store from "./audio-store.js";

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
let seeds = [];
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

async function playBlobs(blobs, onStart) {
  stopPlayback();
  const token = playToken;
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

// ---- Microphone capture ---------------------------------------------------------------------------------------

let stream = null;
let mediaRecorder = null;
let pieces = [];

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
  activeRecorder?.render();
}

// ---- Card recorder (one card at a time) -----------------------------------------------------------------------

let activeRecorder = null;

function createRecorder(container, onSaved) {
  let cards = [];
  let index = 0;
  let recording = false;
  let message = "";
  const parts = {
    count: el("p", undefined, { className: "recorder-count" }),
    greek: el("p", undefined, { className: "recorder-greek", lang: "grc" }),
    gloss: el("p", undefined, { className: "recorder-gloss" }),
    note: el("p", undefined, { className: "recorder-note" }),
    status: el("p", undefined, { className: "recorder-status", role: "status" })
  };
  const button = (label, name, handler) => {
    const node = el("button", label, { type: "button", ariaLabel: name, title: name });
    if (handler) node.addEventListener("click", handler);
    return node;
  };
  const previous = button("\u23EE\uFE0E", "Previous card", () => move(-1));
  const record = button("\u25CF", "Hold to record, release to stop", undefined);
  record.classList.add("record-hold");
  const play = button("\u25B6", "Play recording", () => playBlobs([clips.get(cards[index].greek).blob]));
  const next = button("\u23ED\uFE0E", "Next card without a recording", () => move(1));
  const actions = el("div", undefined, { className: "recorder-actions" });
  actions.append(previous, record, play, next);
  container.replaceChildren(parts.count, parts.greek, parts.gloss, parts.note, actions, parts.status);

  const missingFrom = (from) => {
    for (let offset = 1; offset <= cards.length; offset += 1) {
      const candidate = (from + offset) % cards.length;
      if (!clips.has(cards[candidate].greek)) return candidate;
    }
    return -1;
  };

  // Going forward skips cards that already have a recording; only when none are left ahead does it step one card.
  const forwardTarget = () => {
    const missing = cards.findIndex((card, position) => position > index && !clips.has(card.greek));
    if (missing >= 0) return missing;
    return index < cards.length - 1 ? index + 1 : -1;
  };

  function render() {
    const card = cards[index];
    container.hidden = !card;
    if (!card) return;
    const recorded = cards.filter((item) => clips.has(item.greek)).length;
    const left = cards.length - recorded;
    parts.count.textContent = `Card ${index + 1} of ${cards.length} · ${recorded} recorded · about ${Math.ceil(left * secondsPerCard / 60)} min left`;
    parts.greek.textContent = card.greek;
    parts.gloss.textContent = card.gloss && card.gloss !== "-" ? `“${card.gloss}”` : "";
    parts.note.textContent = card.verses ? `Used in ${card.verses.join(", ")}` : "";
    record.classList.toggle("recording", recording);
    record.title = clips.has(card.greek) ? "Hold to re-record, release to stop" : "Hold to record, release to stop";
    record.setAttribute("aria-pressed", String(recording));
    play.disabled = recording || !clips.has(card.greek);
    previous.disabled = recording || index === 0;
    next.disabled = recording || forwardTarget() < 0;
    parts.status.textContent = message || (left === 0 ? "All cards recorded." : "Hold ● (or Space) while you say the word, then let go.");
  }

  function move(delta) {
    const target = delta > 0 ? forwardTarget() : index + delta;
    if (target < 0 || target >= cards.length) return;
    index = target;
    message = "";
    render();
  }

  let holding = false;
  let pending = null;

  async function finish() {
    const card = cards[index];
    try {
      const blob = await stopCapture();
      recording = false;
      if (blob.size) {
        await store.saveClip(card.greek, blob);
        clips.set(card.greek, { blob, mime: blob.type });
        message = `Saved “${card.greek}”.`;
        const upcoming = missingFrom(index);
        if (upcoming >= 0) index = upcoming;
        onSaved();
      } else {
        message = "Nothing was recorded. Hold the button a little longer.";
      }
    } catch (error) {
      recording = false;
      message = `Could not save: ${error.message}`;
    }
    render();
  }

  // Press and hold: recording runs while the button (or Space) is held down and is saved on release.
  async function press() {
    if (holding || recording || !cards[index]) return;
    holding = true;
    pending = (async () => {
      try {
        await startCapture();
        recording = true;
        message = "Recording…";
        render();
        if (!holding) await finish();
      } catch (error) {
        recording = false;
        holding = false;
        message = `Microphone unavailable: ${error.message}`;
        render();
      }
    })();
    await pending;
  }

  async function release() {
    if (!holding) return;
    holding = false;
    await pending;
    if (recording) await finish();
  }

  record.addEventListener("pointerdown", (event) => {
    if (event.button) return;
    event.preventDefault();
    record.setPointerCapture?.(event.pointerId);
    press();
  });
  for (const type of ["pointerup", "pointercancel"]) record.addEventListener(type, release);
  record.addEventListener("contextmenu", (event) => event.preventDefault());
  record.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) press();
  });
  record.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") release();
  });

  return {
    render,
    press,
    release,
    get recording() { return recording; },
    setCards(list) {
      cards = list;
      recording = false;
      holding = false;
      message = "";
      const first = cards.findIndex((card) => !clips.has(card.greek));
      index = first >= 0 ? first : 0;
      render();
    }
  };
}

document.addEventListener("keydown", (event) => {
  if (event.key !== " " || !activeRecorder || event.target.closest("input, select, textarea, button, a")) return;
  event.preventDefault();
  if (!event.repeat) activeRecorder.press();
});
document.addEventListener("keyup", (event) => {
  if (event.key === " " && activeRecorder) activeRecorder.release();
});

// ---- Progress and breadcrumbs ---------------------------------------------------------------------------------

const done = {
  language: () => Boolean(state.language.trim()),
  seed: () => seedCards(seeds, state.unspoken).length > 0 && seedCards(seeds, state.unspoken).every((card) => clips.has(card.greek)),
  grammar: () => seeds.length > 0 && seeds.every((seed) => state.seedOrders[seed.verse]),
  books: () => Boolean(plan) && plan.cards.every((card) => state.unspoken[card.greek] || clips.has(card.greek)),
  export: () => false
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
  const recordingSteps = ["seed", "grammar", "books"];
  section.hidden = !recordingSteps.includes(step);
  if (section.hidden) return;
  const chapterSelect = $("#listen-chapter");
  let verses;
  if (step === "books") {
    verses = await bookVerses($("#book-select").value);
    const chapters = [...new Set(verses.map((verse) => chapterOf(verse.verse)))];
    const previous = chapterSelect.value;
    chapterSelect.replaceChildren(...chapters.map((chapter) => el("option", `Chapter ${chapter}`, { value: String(chapter) })));
    if (chapters.includes(Number(previous))) chapterSelect.value = previous;
    else {
      const firstReady = chapters.find((chapter) => verses.some((verse) => chapterOf(verse.verse) === chapter && verseStatus(verse.words, clips, state.unspoken).complete));
      chapterSelect.value = String(firstReady ?? chapters[0] ?? "");
    }
    chapterSelect.hidden = false;
    verses = verses.filter((verse) => String(chapterOf(verse.verse)) === chapterSelect.value);
  } else {
    chapterSelect.hidden = true;
    verses = seeds;
  }
  const onlyComplete = $("#listen-complete").checked;
  const ready = verses.filter((verse) => verseStatus(verse.words, clips, state.unspoken).complete);
  $("#listen-summary").textContent = verses.length
    ? `${ready.length} of ${verses.length} verses can be played.`
    : "This build has no verses for this selection.";
  $("#listen-list").replaceChildren(...(onlyComplete ? ready : verses).map((verse) => {
    const status = verseStatus(verse.words, clips, state.unspoken);
    const item = el("li", undefined, { className: status.complete ? "" : "incomplete" });
    const lemmas = playbackLemmas(verse.words, state.rules, state.seedOrders[verse.verse], state.unspoken);
    const play = el("button", `▶ ${verse.verse}`, { type: "button", disabled: !status.complete });
    play.addEventListener("click", () => {
      item.classList.add("playing");
      playBlobs(lemmas.map((lemma) => clips.get(lemma).blob)).finally(() => item.classList.remove("playing"));
    });
    item.append(play, el("span", verse.words.map((word) => word.surface).join(" "), { lang: "grc", className: "listen-greek" }),
      el("small", status.complete ? `Plays: ${lemmas.join(" ")}` : `${status.missing.length} word(s) still to record`, { className: "listen-order" }));
    return item;
  }));
}

// ---- Steps ----------------------------------------------------------------------------------------------------

let seedRecorder;
let bookRecorder;

function renderSeed() {
  seedRecorder.setCards(seedCards(seeds, state.unspoken));
  activeRecorder = seedRecorder;
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
  bookRecorder.setCards(cards);
  activeRecorder = bookRecorder;
  renderListen();
}

function renderGrammar() {
  const container = $("#grammar-samples");
  const rebuild = () => {
    const examples = seeds.filter((seed) => state.seedOrders[seed.verse])
      .map((seed) => ({ chunks: chunkWords(seed.words), order: state.seedOrders[seed.verse] }));
    state.rules = learnRules(examples);
    saveSoon();
    $("#grammar-summary").textContent = `${examples.length} of ${seeds.length} verses arranged · ${Object.keys(state.rules).length} word-order rules learned.`;
    renderCrumbs();
    renderListen();
  };
  const redraws = [];
  const setUnspoken = (lemmas, off) => {
    for (const lemma of lemmas) {
      if (off) state.unspoken[lemma] = true;
      else delete state.unspoken[lemma];
    }
    saveSoon();
    renderCrumbs();
    renderListen();
    for (const redraw of redraws) redraw();
  };
  container.replaceChildren(...seeds.map((seed) => {
    const chunks = chunkWords(seed.words);
    let order = state.seedOrders[seed.verse] ?? chunks.map((_, index) => index);
    const section = el("section", undefined, { className: "grammar-sample" });
    const list = el("ol", undefined, { className: "grammar-chunks" });
    const confirmation = el("p", undefined, { className: "grammar-confirmation" });
    const confirm = el("button", "This order is right", { type: "button" });
    const reset = el("button", "Reset to Greek order", { type: "button" });
    const commit = () => {
      state.seedOrders[seed.verse] = order.slice();
      rebuild();
      draw();
    };
    const move = (from, to) => {
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      commit();
    };
    function draw() {
      confirmation.textContent = state.seedOrders[seed.verse] ? "✓ Order saved" : "Drag the chunks into your language's order.";
      list.replaceChildren(...order.map((chunkIndex, position) => {
        const chunk = chunks[chunkIndex];
        const item = el("li", undefined, { draggable: true, className: "grammar-chunk" });
        const speakable = chunk.words.filter((word) => !isProperNoun(word));
        const allOff = speakable.length > 0 && speakable.every((word) => state.unspoken[word.lemma]);
        const unspokenButton = (label, name, pressed, handler, className) => {
          const node = el("button", label, { type: "button", ariaLabel: name, title: name, className });
          node.setAttribute("aria-pressed", String(pressed));
          node.addEventListener("click", handler);
          return node;
        };
        if (speakable.length) {
          item.append(unspokenButton("\u2205", allOff ? "Speak every word in this card" : "Leave out every word in this card", allOff,
            () => setUnspoken(speakable.map((word) => word.lemma), !allOff), "unspoken-card"));
        }
        const wordList = el("span", undefined, { lang: "grc", className: "grammar-words" });
        for (const word of chunk.words) {
          const off = Boolean(state.unspoken[word.lemma]);
          const wordNode = el("span", undefined, { className: off ? "grammar-word unspoken" : "grammar-word" });
          wordNode.append(el("span", word.surface));
          if (speakable.length > 1 && !isProperNoun(word)) {
            wordNode.append(unspokenButton("\u2205", off ? `Speak ${word.surface}` : `Leave out ${word.surface}`, off,
              () => setUnspoken([word.lemma], !off), "unspoken-word"));
          }
          wordList.append(wordNode);
        }
        item.append(wordList,
          el("small", chunk.words.map((word) => word.gloss).filter(Boolean).join(" ")),
          el("small", chunk.slot, { className: "grammar-slot" }));
        item.classList.toggle("unspoken", allOff);
        for (const [label, delta] of [["←", -1], ["→", 1]]) {
          const arrow = el("button", label, { type: "button", ariaLabel: delta < 0 ? "Move earlier" : "Move later", disabled: position + delta < 0 || position + delta >= order.length });
          arrow.addEventListener("click", () => move(position, position + delta));
          item.append(arrow);
        }
        item.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(position)));
        item.addEventListener("dragover", (event) => event.preventDefault());
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          move(Number(event.dataTransfer.getData("text/plain")), position);
        });
        return item;
      }));
    }
    confirm.addEventListener("click", commit);
    reset.addEventListener("click", () => {
      order = chunks.map((_, index) => index);
      delete state.seedOrders[seed.verse];
      rebuild();
      draw();
    });
    section.append(el("h3", seed.verse), list, confirmation, confirm, reset);
    redraws.push(draw);
    draw();
    return section;
  }));
  rebuild();
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
        clips.set(clip.lemma, { blob: typed, mime: clip.mime });
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
  if (step === "seed") renderSeed();
  if (step === "grammar") renderGrammar();
  if (step === "books") renderBooks();
  if (step === "export") renderExport();
  renderListen();
}

async function initialize() {
  [state, clips] = await Promise.all([store.loadState(), store.loadClips()]);
  [seeds, plan] = await Promise.all([fetchJson(root.dataset.seeds).catch(() => []), fetchJson(root.dataset.plan).catch(() => null)]);
  seedRecorder = createRecorder($("#seed-recorder"), renderCrumbs);
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
  $("#book-select").addEventListener("change", showBook);
  $("#listen-chapter").addEventListener("change", renderListen);
  $("#listen-complete").addEventListener("change", renderListen);
  $("#listen-stop").addEventListener("click", stopPlayback);
  $("#export-button").addEventListener("click", exportAll);
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
