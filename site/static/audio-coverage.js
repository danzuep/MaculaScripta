// Audio coverage: which translated words still need audio, and which verse to record next.
// The pure functions below take plain items so they can be tested without a DOM.
// Each item is { verse, translated, hasAudio, keys }, in document order. `keys` are the
// recorder's clip keys: a clip saved for an item is linked to every item sharing any key.

const languageNames = { en: "English", yue: "Cantonese" };
const idleTimeoutMs = 800;
const minSliceMs = 8;
const maxSliceMs = 16;

export function cellState(item) {
  if (item.hasAudio) return "audio";
  return item.translated ? "missing" : "untranslated";
}

const isMissing = (item) => item.translated && !item.hasAudio;

export function buildCoverageIndex(items) {
  const verses = [];
  const byVerse = new Map();
  const groups = new Map();
  items.forEach((item, position) => {
    let verse = byVerse.get(item.verse);
    if (!verse) {
      verse = { key: item.verse, order: verses.length, items: [] };
      byVerse.set(item.verse, verse);
      verses.push(verse);
    }
    verse.items.push(position);
    for (const key of item.keys) {
      const group = groups.get(key);
      if (group) group.push(position);
      else groups.set(key, [position]);
    }
  });
  return { items, verses, byVerse, groups };
}

// Effort: clips needed for the verse's missing words, where one clip also covers later words
// sharing its keys. Impact: missing occurrences across the workspace that those clips fill.
export function scoreVerse(index, verse) {
  const { items, groups } = index;
  const filled = new Set();
  const seenKeys = new Set();
  let effort = 0;
  for (const position of verse.items) {
    if (!isMissing(items[position]) || filled.has(position)) continue;
    effort += 1;
    filled.add(position);
    for (const key of items[position].keys) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      for (const linked of groups.get(key)) {
        if (isMissing(items[linked])) filled.add(linked);
      }
    }
  }
  return { verse, effort, impact: filled.size, filled };
}

const versesPerSlice = 25;

function drain(steps) {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

// Highest impact, then lowest effort, then document order. Yields between slices of verses
// so the page can split scoring across idle periods.
export function* recommendSteps(index) {
  let best = null;
  for (const verse of index.verses) {
    const score = scoreVerse(index, verse);
    if (score.effort && (!best || score.impact > best.impact
      || (score.impact === best.impact && score.effort < best.effort))) best = score;
    if ((verse.order + 1) % versesPerSlice === 0) yield;
  }
  return best;
}

export const recommendVerse = (index) => drain(recommendSteps(index));

export function* summarizeSteps(index) {
  let translated = 0;
  let withAudio = 0;
  for (const item of index.items) {
    if (!item.translated) continue;
    translated += 1;
    if (item.hasAudio) withAudio += 1;
  }
  const missing = translated - withAudio;
  const state = !translated ? "empty" : missing ? "available" : "complete";
  return {
    state, translated, withAudio, missing,
    recommendation: state === "available" ? yield* recommendSteps(index) : null
  };
}

export const summarizeCoverage = (index) => drain(summarizeSteps(index));

// Updates audio flags in place; returns the positions whose state changed.
export function applyAudio(index, hasAudio) {
  const changed = [];
  index.items.forEach((item, position) => {
    const next = Boolean(hasAudio(position));
    if (item.hasAudio === next) return;
    item.hasAudio = next;
    changed.push(position);
  });
  return changed;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function scheduleIdle(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: idleTimeoutMs });
  } else {
    setTimeout(callback, 1);
  }
}

function makeCells(states) {
  const fragment = document.createDocumentFragment();
  for (const state of states) {
    const cell = document.createElement("span");
    cell.className = "coverage-cell";
    cell.dataset.state = state;
    fragment.append(cell);
  }
  return fragment;
}

export function setupAudioCoverage(api) {
  const panel = document.querySelector("#coverage-next");
  const ui = panel && {
    title: panel.querySelector("#coverage-next-title"),
    verse: panel.querySelector("#coverage-next-verse"),
    before: panel.querySelector("#coverage-next-before"),
    after: panel.querySelector("#coverage-next-after"),
    impact: panel.querySelector("#coverage-next-impact"),
    summary: panel.querySelector("#coverage-next-summary"),
    record: panel.querySelector("#coverage-next-record")
  };
  let index = null;
  let cards = [];
  let cardIds = [];
  let cells = [];
  let verseElements = new Map();
  let strips = new Map();
  const stripParts = new WeakMap();
  let recommendation = null;
  let structural = true;
  let audioChanged = false;
  let rebuilding = false;
  let job = null;
  let scheduled = false;

  const verseKey = (verse) => `${verse.lang}:${verse.dataset.verse}`;

  function request() {
    audioChanged = true;
    schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    scheduleIdle(run);
  }

  // Work runs in idle slices; a structural change restarts any unfinished job.
  function run(deadline) {
    scheduled = false;
    const started = performance.now();
    const budget = Math.min(maxSliceMs, Math.max(minSliceMs, deadline?.timeRemaining?.() ?? 0));
    if (structural) {
      structural = false;
      audioChanged = false;
      job = rebuildSteps();
    } else if (!job && audioChanged) {
      audioChanged = false;
      job = cards.some((card) => !card.isConnected) ? rebuildSteps() : syncSteps();
    }
    while (job) {
      if (job.next().done) job = null;
      else if (performance.now() - started >= budget) break;
    }
    if (job || structural || audioChanged) schedule();
  }

  function createStrip(verse) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "coverage-strip";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "verse-clipper");
    const cellsElement = document.createElement("span");
    cellsElement.className = "coverage-cells";
    cellsElement.setAttribute("aria-hidden", "true");
    const count = document.createElement("span");
    count.className = "coverage-count";
    count.setAttribute("aria-hidden", "true");
    button.append(cellsElement, count);
    const heading = verse.querySelector("h2");
    heading.insertBefore(button, heading.querySelector(".play-verse"));
    const strip = { button, cells: cellsElement, count };
    stripParts.set(button, strip);
    return strip;
  }

  function stripFor(verse) {
    const button = verse.querySelector("h2 > .coverage-strip");
    if (button && stripParts.has(button)) return stripParts.get(button);
    button?.remove();
    return createStrip(verse);
  }

  function* rebuildSteps() {
    rebuilding = true;
    const nextVerses = new Map();
    const nextCards = [];
    const nextIds = [];
    const items = [];
    for (const verse of document.querySelectorAll(".verse")) {
      if (!verse.querySelector("h2")) continue;
      const key = verseKey(verse);
      nextVerses.set(key, verse);
      for (const card of verse.querySelectorAll(".token-card")) {
        const id = api.cardId(card);
        nextCards.push(card);
        nextIds.push(id);
        items.push({
          verse: key,
          translated: Boolean(api.targetText(card)),
          hasAudio: api.hasRecording(id),
          keys: api.clipKeys(card)
        });
      }
      yield;
    }
    const nextIndex = buildCoverageIndex(items);
    yield;
    const nextCells = new Array(nextCards.length);
    const nextStrips = new Map();
    for (const [key, verse] of nextVerses) {
      const strip = stripFor(verse);
      nextStrips.set(key, strip);
      strip.verse = nextIndex.byVerse.get(key) || { key, items: [] };
      strip.button.hidden = !strip.verse.items.length;
      strip.cells.replaceChildren(makeCells(strip.verse.items.map((position) => cellState(nextIndex.items[position]))));
      [...strip.cells.children].forEach((cell, offset) => {
        const position = strip.verse.items[offset];
        cell.dataset.position = String(position);
        nextCells[position] = cell;
      });
      updateStrip(strip, verse, nextIndex);
      yield;
    }
    index = nextIndex;
    cards = nextCards;
    cardIds = nextIds;
    cells = nextCells;
    verseElements = nextVerses;
    strips = nextStrips;
    rebuilding = false;
    yield* panelSteps();
  }

  // After a clip is saved only audio flags change, so update just the affected cells.
  function* syncSteps() {
    if (!index) return;
    const changed = applyAudio(index, (position) => api.hasRecording(cardIds[position]));
    if (!changed.length) return;
    const touched = new Set();
    for (const position of changed) {
      cells[position].dataset.state = cellState(index.items[position]);
      touched.add(index.items[position].verse);
    }
    for (const key of touched) updateStrip(strips.get(key), verseElements.get(key), index);
    yield;
    yield* panelSteps();
  }

  function* panelSteps() {
    if (ui) renderPanel(yield* summarizeSteps(index));
  }

  function updateStrip(strip, verse, coverage) {
    let translated = 0;
    let withAudio = 0;
    let untranslated = 0;
    for (const position of strip.verse.items) {
      const item = coverage.items[position];
      if (!item.translated) untranslated += 1;
      else {
        translated += 1;
        if (item.hasAudio) withAudio += 1;
      }
    }
    const missing = translated - withAudio;
    strip.count.textContent = translated ? `${withAudio}/${translated}` : "";
    strip.button.disabled = !missing;
    strip.button.dataset.complete = String(Boolean(translated) && !missing);
    const parts = [translated
      ? `${withAudio} of ${plural(translated, "translated word")} have audio`
      : "No translated words yet"];
    if (untranslated) parts.push(`${untranslated} untranslated`);
    const action = missing ? `. Record ${plural(missing, "missing word")}` : "";
    strip.button.setAttribute("aria-label", `Audio coverage for ${verse.dataset.verse}: ${parts.join(", ")}${action}`);
    strip.button.title = missing ? "Select a missing word to record it" : parts.join(", ");
  }

  function renderPanel(summary) {
    recommendation = summary.recommendation;
    panel.dataset.state = summary.state;
    ui.record.disabled = !recommendation;
    const have = summary.translated ? summary.withAudio / summary.translated : 0;
    const gain = recommendation ? recommendation.impact / summary.translated : 0;
    ui.impact.style.setProperty("--have", `${(have * 100).toFixed(2)}%`);
    ui.impact.style.setProperty("--gain", `${(gain * 100).toFixed(2)}%`);
    if (summary.state === "empty") {
      ui.title.textContent = "Best next verse to record";
      ui.verse.textContent = "—";
      ui.before.replaceChildren(makeCells(["untranslated", "untranslated", "untranslated"]));
      ui.after.replaceChildren(makeCells(["untranslated", "untranslated", "untranslated"]));
      ui.summary.textContent = "Translate words to start recording";
      ui.record.removeAttribute("aria-describedby");
      return;
    }
    if (summary.state === "complete") {
      ui.title.textContent = "Complete";
      ui.verse.textContent = "✓ All verses";
      ui.before.replaceChildren(makeCells(["audio", "audio", "audio"]));
      ui.after.replaceChildren();
      ui.summary.textContent = `Every translated word has audio (${summary.translated})`;
      ui.record.removeAttribute("aria-describedby");
      return;
    }
    const { verse, effort, impact } = recommendation;
    const element = verseElements.get(verse.key);
    ui.title.textContent = "Best next verse to record";
    const language = languageNames[element?.lang] || element?.lang || "";
    ui.verse.textContent = element ? `${element.dataset.verse}${language ? ` · ${language}` : ""}` : verse.key;
    const states = verse.items.map((position) => cellState(index.items[position]));
    ui.before.replaceChildren(makeCells(states));
    ui.after.replaceChildren(makeCells(states.map((state) => (state === "missing" ? "gain" : state))));
    ui.summary.textContent = `${plural(effort, "clip")} → fills ${plural(impact, "gap")}`;
    ui.record.setAttribute("aria-describedby", "coverage-next-verse coverage-next-summary");
  }

  function firstMissingCard(entry) {
    const position = entry.items.find((candidate) => cellState(index.items[candidate]) === "missing");
    return position === undefined ? null : cards[position];
  }

  document.addEventListener("click", (event) => {
    const strip = event.target.closest?.(".coverage-strip");
    if (!strip || strip.disabled) return;
    const verse = strip.closest(".verse");
    const entry = index && verse && index.byVerse.get(verseKey(verse));
    if (!verse) return;
    // While a rebuild is rendering, cell positions may not match the committed index yet.
    const position = rebuilding || !index ? undefined : event.target.closest(".coverage-cell")?.dataset.position;
    const card = position !== undefined && cellState(index.items[Number(position)]) === "missing"
      ? cards[Number(position)] : entry && firstMissingCard(entry);
    api.openVerse(verse, card, strip);
  });
  ui?.record.addEventListener("click", () => {
    const key = recommendation?.verse.key;
    const verse = key && verseElements.get(key);
    const entry = key && index.byVerse.get(key);
    if (verse) api.openVerse(verse, entry && firstMissingCard(entry), ui.record);
  });
  document.addEventListener("cardschanged", () => {
    structural = true;
    schedule();
  });
  if (panel) panel.hidden = false;
  schedule();

  return { refresh: request };
}
