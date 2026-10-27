const databaseName = "macula-scripta";
const storeName = "edits";

function openEditDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveEdits(edits) {
  const database = await openEditDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      edits.forEach((edit) => transaction.objectStore(storeName).put(edit));
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readEdits() {
  const database = await openEditDatabase();
  const edits = await new Promise((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return edits;
}

const cards = Array.from(document.querySelectorAll(".token-card"));
const cardTemplates = new Map(cards.map((card) => [cardId(card), card.cloneNode(true)]));
window.maculaScriptaConfig ??= {};
window.maculaScriptaConfig.sourceCards = Object.freeze(cards.map((card) => Object.freeze({
  id: cardId(card),
  languageCode: card.dataset.language,
  lemmaId: card.dataset.lemmaId,
  senseId: card.dataset.senseId,
  targetMaculaIds: Object.freeze(maculaIds(card)),
  targetText: (card.querySelector(".ruby-base") ?? card.querySelector(".target-text")).textContent.trim(),
  legacyTargetText: card.dataset.legacyTargetText || ""
})));
const status = document.querySelector("#edit-status");
const sharedEdits = document.querySelector("#apply-shared-edits");
const theme = document.querySelector("#theme");

function readSetting(key) {
  try {
    return localStorage.getItem(`macula-scripta-${key}`);
  } catch {
    return null;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(`macula-scripta-${key}`, value);
  } catch {
    // Settings still apply for this visit when browser storage is unavailable.
  }
}

function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "light" ? "#f3f6fb" : "#0f172a");
}

if (theme) {
  theme.value = readSetting("theme") === "light" ? "light" : "dark";
  applyTheme(theme.value);
  theme.addEventListener("change", () => {
    applyTheme(theme.value);
    saveSetting("theme", theme.value);
  });
}

function cardId(card) {
  return `${card.closest(".verse").dataset.verse}:${card.dataset.alignmentId}`;
}

function maculaIds(card) {
  return card.dataset.maculaIds.split(",").filter(Boolean);
}

function sharesTranslationSense(source, candidate) {
  const { language, lemmaId, senseId } = source.dataset;
  return Boolean(language?.trim() && lemmaId?.trim() && senseId?.trim())
    && candidate.dataset.language === language
    && candidate.dataset.lemmaId === lemmaId
    && candidate.dataset.senseId === senseId;
}

function updateCard(card, text) {
  const target = card.querySelector(".ruby-base") ?? card.querySelector(".target-text");
  target.textContent = text;
  card.querySelector(".edit-token").setAttribute("aria-label", `Edit ${text}`);
}

function layoutId(verse) {
  return `layout:${verse.lang}:${verse.dataset.verse}`;
}

function cardState(card) {
  return {
    templateId: card.dataset.templateId || cardId(card),
    alignmentId: card.dataset.alignmentId,
    targetMaculaIds: maculaIds(card),
    targetText: (card.querySelector(".ruby-base") ?? card.querySelector(".target-text")).textContent.trim(),
    greekText: card.querySelector(".sub-greek")?.textContent.trim() || "",
    languageCode: card.dataset.language,
    lemmaId: card.dataset.lemmaId,
    senseId: card.dataset.senseId,
    members: card.joinedMembers
  };
}

function restoreCard(state) {
  const template = cardTemplates.get(state.templateId);
  if (!template) throw new Error("The saved card no longer exists in this passage.");
  const card = template.cloneNode(true);
  card.dataset.templateId = state.templateId;
  card.dataset.alignmentId = state.alignmentId;
  card.dataset.maculaIds = state.targetMaculaIds.join(",");
  card.dataset.language = state.languageCode;
  card.dataset.lemmaId = state.lemmaId || "";
  card.dataset.senseId = state.senseId || "";
  card.joinedMembers = state.members;
  if (state.members) {
    delete card.dataset.legacyTargetText;
    card.querySelector(".target-text").replaceChildren();
    const details = card.querySelector(".token-detail-content");
    details.replaceChildren();
    const description = document.createElement("span");
    description.textContent = `Joined card · Macula IDs: ${state.targetMaculaIds.join(", ")}. Split to edit individual word senses.`;
    details.append(description);
  }
  updateCard(card, state.targetText);
  const greek = card.querySelector(".sub-greek") || document.createElement("span");
  greek.className = "sub-greek";
  greek.lang = "grc";
  greek.textContent = state.greekText;
  if (!greek.parentNode) card.querySelector(".target-text").after(greek);
  return card;
}

function layoutEdit(verse, orderedCards) {
  return {
    id: layoutId(verse),
    kind: "card-layout",
    verseReference: verse.dataset.verse,
    languageCode: verse.lang,
    cards: orderedCards.map(cardState),
    updatedAt: new Date().toISOString()
  };
}

function refreshCards() {
  cards.splice(0, cards.length, ...document.querySelectorAll(".token-card"));
  cards.forEach((card) => {
    card.querySelector(".move-card-earlier").disabled = !card.previousElementSibling?.matches(".token-card");
    card.querySelector(".move-card-later").disabled = !card.nextElementSibling?.matches(".token-card");
    card.querySelector(".join-card").disabled = !card.nextElementSibling?.matches(".token-card");
    card.querySelector(".split-card").disabled = !card.joinedMembers;
  });
  document.dispatchEvent(new Event("cardschanged"));
}

function normalizeLegacyWordText(record) {
  const normalized = { ...record };
  if (record.targetText === "∅") normalized.targetText = "";
  if (record.members) {
    normalized.members = record.members.map(normalizeLegacyWordText);
  }
  if (record.cards) {
    normalized.cards = record.cards.map(normalizeLegacyWordText);
  }
  const alignmentId = record.alignmentId || record.id?.split(":").at(-1);
  if (alignmentId === "en-JHN_1_1_01"
      && ["In the beginning", "the beginning"].includes(record.targetText)) {
    normalized.targetText = "[the] beginning";
  }
  if (["en-JHN_1_1_03", "en-JHN_1_1_05", "en-JHN_1_1_12"].includes(alignmentId)
      && record.targetText === "the Word") {
    normalized.targetText = "Word";
  }
  const sourceIds = record.targetMaculaIds || [];
  if (record.members && record.languageCode === "en") {
    const joinedText = (members) => members.map((member) => member.targetText)
      .filter((text) => text && text !== "∅").join(" ");
    if (record.targetText === joinedText(record.members)) {
      normalized.targetText = joinedText(normalized.members);
    }
  }
  if (sourceIds.length === 2
      && sourceIds.includes("n43001001001") && sourceIds.includes("n43001001002")
      && record.languageCode === "en"
      && alignmentId?.startsWith("joined-")
      && ["In In the beginning", "In the beginning"].includes(record.targetText)) {
    normalized.targetText = "In [the] beginning";
  }
  if (sourceIds.length === 2 && record.languageCode === "en"
      && alignmentId?.startsWith("joined-") && record.targetText === "the the Word"
      && [["n43001001004", "n43001001005"], ["n43001001007", "n43001001008"],
        ["n43001001016", "n43001001017"]]
        .some((pair) => pair.every((id) => sourceIds.includes(id)))) {
    normalized.targetText = "the Word";
  }
  return normalized;
}

const editsReady = readEdits().then(async (savedEdits) => {
  const edits = savedEdits.map(normalizeLegacyWordText);
  const migrated = edits.filter((edit, index) => JSON.stringify(edit) !== JSON.stringify(savedEdits[index]));
  if (migrated.length) await saveEdits(migrated);
  const editsById = new Map(edits.map((edit) => [edit.id, edit]));
  let skippedLayouts = 0;
  document.querySelectorAll(".verse").forEach((verse) => {
    const layout = editsById.get(layoutId(verse));
    if (layout?.kind === "card-layout") {
      try {
        const originalIds = new Set([...verse.querySelectorAll(".token-card")].map(cardId));
        const leafIds = (states) => states.flatMap((state) =>
          state.members ? leafIds(state.members) : [state.templateId]);
        const savedIds = leafIds(layout.cards);
        if (savedIds.length !== originalIds.size || new Set(savedIds).size !== savedIds.length
            || savedIds.some((id) => !originalIds.has(id))) {
          throw new Error("The passage's source cards have changed.");
        }
        const restored = layout.cards.map(restoreCard);
        verse.querySelector(".verse-flow").replaceChildren(...restored);
      } catch {
        skippedLayouts += 1;
      }
    }
  });
  refreshCards();
  cards.forEach((card) => {
    const edit = editsById.get(cardId(card));
    if (typeof edit?.targetText === "string") updateCard(card, edit.targetText);
  });
  document.dispatchEvent(new Event("cardschanged"));
  if (skippedLayouts) {
    status.textContent = `${skippedLayouts} saved arrangement(s) no longer match the published source cards. Original cards are shown; saved text edits still apply. Export before rearranging to retain the old layout.`;
  }
}).catch(() => {
  status.textContent = "Saved offline edits could not be loaded. Browser storage may be unavailable.";
});
refreshCards();

let saving = false;
let editingCard;
let editTrigger;
const editor = document.querySelector("#text-editor");
const editorForm = document.querySelector("#text-editor-form");
const editorValue = document.querySelector("#text-editor-value");
const editorError = document.querySelector("#text-editor-error");
const saveButton = document.querySelector("#save-text-edit");
const cancelButton = document.querySelector("#cancel-text-edit");

function affectedCardsFor(card) {
  return sharedEdits?.checked
    ? cards.filter((candidate) => candidate === card || sharesTranslationSense(card, candidate))
    : [card];
}

function updateEditorScope() {
  if (!editingCard) return;
  const count = affectedCardsFor(editingCard).length;
  document.querySelector("#text-editor-scope").textContent = count > 1
    ? `This will update ${count} cards with the same language, lemma, and word sense. Pronunciation annotations are preserved.`
    : "Only this card will change. Pronunciation annotations are preserved.";
}

sharedEdits?.addEventListener("change", updateEditorScope);
document.querySelector("#record-editor-audio")?.addEventListener("click", (event) => {
  if (!editingCard || saving) return;
  document.dispatchEvent(new CustomEvent("recordcard", {
    detail: { card: editingCard, trigger: event.currentTarget }
  }));
});

document.addEventListener("click", async (event) => {
    const button = event.target.closest(".edit-token");
    if (!button) return;
    await editsReady;
    if (saving || editor.open || layoutSaving) return;
    editingCard = button.closest(".token-card");
    editTrigger = button;
    sharedEdits.checked = true;
    const target = editingCard.querySelector(".ruby-base") ?? editingCard.querySelector(".target-text");
    editorValue.value = target.textContent.trim();
    editorError.textContent = "";
    document.querySelector("#text-editor-context").textContent =
      `${editingCard.closest(".verse").dataset.verse} · ${editingCard.dataset.language}`;
    updateEditorScope();
    document.dispatchEvent(new Event("workspaceediting"));
    editor.showModal();
    editorValue.focus();
    editorValue.select();
});

editor?.addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
editor?.addEventListener("close", () => editTrigger?.focus());
cancelButton?.addEventListener("click", () => editor.close());
editorForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !editingCard) return;
  const replacement = editorValue.value.trim();
  const affectedCards = affectedCardsFor(editingCard);
  const updatedAt = new Date().toISOString();
  const edits = affectedCards.map((affected) => ({
    id: cardId(affected),
    verseReference: affected.closest(".verse").dataset.verse,
    alignmentId: affected.dataset.alignmentId,
    targetMaculaIds: maculaIds(affected),
    languageCode: affected.dataset.language,
    lemmaId: affected.dataset.lemmaId,
    senseId: affected.dataset.senseId,
    targetText: replacement,
    updatedAt
  }));
  saving = true;
  saveButton.disabled = true;
  cancelButton.disabled = true;
  editorError.textContent = "";
  try {
    await saveEdits(edits);
    cards.forEach((candidate) => candidate.classList.remove("recently-edited"));
    affectedCards.forEach((affected) => {
      updateCard(affected, replacement);
      affected.classList.add("recently-edited");
    });
    status.textContent = `Saved ${affectedCards.length} card${affectedCards.length === 1 ? "" : "s"} offline. Recently edited cards are shaded.`;
    editor.close();
  } catch {
    status.textContent = "Unable to save this edit. No cards were changed. Check browser storage and try again.";
    editorError.textContent = status.textContent;
  } finally {
    saving = false;
    saveButton.disabled = false;
    cancelButton.disabled = false;
  }
});

let layoutSaving = false;
let splittingCard;
let splitTrigger;
const splitEditor = document.querySelector("#split-editor");
const splitFields = document.querySelector("#split-editor-fields");

async function persistLayout(verse, orderedCards, extraEdits = []) {
  if (layoutSaving || saving) return false;
  layoutSaving = true;
  try {
    await saveEdits([...extraEdits, layoutEdit(verse, orderedCards)]);
    verse.querySelector(".verse-flow").replaceChildren(...orderedCards);
    refreshCards();
    status.textContent = "Card arrangement saved offline. Export text edits to keep its word alignments and order.";
    return true;
  } catch {
    status.textContent = "Unable to save the card arrangement. No cards were changed.";
    return false;
  } finally {
    layoutSaving = false;
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".card-layout-actions button");
  if (!button) return;
  await editsReady;
  if (layoutSaving || saving || editor.open || splitEditor.open) return;
  const card = button.closest(".token-card");
  const verse = card.closest(".verse");
  const ordered = [...verse.querySelectorAll(".token-card")];
  const index = ordered.indexOf(card);
  document.dispatchEvent(new Event("workspaceediting"));
  if (button.matches(".split-card")) {
    if (!card.joinedMembers) return;
    splittingCard = card;
    splitTrigger = button;
    document.querySelector("#split-editor-context").textContent = `Joined text: ${cardState(card).targetText}`;
    document.querySelector("#split-editor-error").textContent = "";
    splitFields.replaceChildren();
    card.joinedMembers.forEach((member) => {
      const label = document.createElement("label");
      label.textContent = member.greekText || "Unaligned translation";
      const input = document.createElement("input");
      input.value = member.targetText;
      label.append(input);
      splitFields.append(label);
    });
    splitEditor.showModal();
    splitFields.querySelector("input")?.focus();
    return;
  }
  if (button.matches(".join-card")) {
    const next = ordered[index + 1];
    if (!next) return;
    const members = [cardState(card), cardState(next)];
    const joined = restoreCard({
      ...members[0],
      alignmentId: `joined-${crypto.randomUUID()}`,
      targetMaculaIds: [...new Set(members.flatMap((member) => member.targetMaculaIds))],
      targetText: members.map((member) => member.targetText).filter(Boolean)
        .join(card.dataset.language === "yue" ? "" : " "),
      greekText: members.map((member) => member.greekText).join(" "),
      lemmaId: "",
      senseId: "",
      members
    });
    ordered.splice(index, 2, joined);
    if (await persistLayout(verse, ordered)) joined.querySelector(".edit-token").focus();
    return;
  }
  const destination = index + (button.matches(".move-card-earlier") ? -1 : 1);
  if (destination < 0 || destination >= ordered.length) return;
  [ordered[index], ordered[destination]] = [ordered[destination], ordered[index]];
  if (await persistLayout(verse, ordered)) card.querySelector(".edit-token").focus();
});

document.querySelector("#cancel-split")?.addEventListener("click", () => splitEditor.close());
splitEditor?.addEventListener("cancel", (event) => {
  if (layoutSaving) event.preventDefault();
});
splitEditor?.addEventListener("close", () => {
  if (splitTrigger?.isConnected) splitTrigger.focus();
});
document.querySelector("#split-editor-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!splittingCard || layoutSaving) return;
  const values = [...splitFields.querySelectorAll("input")].map((input) => input.value.trim());
  const verse = splittingCard.closest(".verse");
  const restored = splittingCard.joinedMembers.map((member, index) => restoreCard({
    ...member, targetText: values[index]
  }));
  const ordered = [...verse.querySelectorAll(".token-card")];
  ordered.splice(ordered.indexOf(splittingCard), 1, ...restored);
  const updatedAt = new Date().toISOString();
  const edits = restored.map((card) => ({
    ...cardState(card),
    id: `${verse.dataset.verse}:${card.dataset.alignmentId}`,
    verseReference: verse.dataset.verse,
    updatedAt
  }));
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (await persistLayout(verse, ordered, edits)) {
      splitEditor.close();
      restored[0].querySelector(".edit-token").focus();
    } else {
      document.querySelector("#split-editor-error").textContent = status.textContent;
    }
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});

const verseFilter = document.querySelector("#verse-filter");
const languageFilter = document.querySelector("#language-filter");
function filterTranslations() {
  let visible = 0;
  document.querySelectorAll(".verse").forEach((verse) => {
    verse.hidden = Boolean((verseFilter.value && verse.dataset.verse !== verseFilter.value)
      || (languageFilter.value && verse.lang !== languageFilter.value));
    if (!verse.hidden) visible += 1;
  });
  document.querySelector("#filter-status").textContent = `${visible} translation${visible === 1 ? "" : "s"}`;
}
if (verseFilter && languageFilter) {
  document.querySelector(".translation-toolbar").hidden = false;
  verseFilter.addEventListener("change", filterTranslations);
  languageFilter.addEventListener("change", filterTranslations);
  filterTranslations();
}
document.querySelector("#translations")?.addEventListener("focusin", () => {
  document.dispatchEvent(new Event("workspaceediting"));
});

document.querySelector("#export-edits")?.addEventListener("click", async () => {
  try {
    await editsReady;
    const patch = new Blob([JSON.stringify(await readEdits(), null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(patch);
    const link = document.createElement("a");
    link.href = url;
    link.download = "macula-scripta-edits.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = "Text edits exported. Dictionary recordings can be exported from Record & dictionary.";
  } catch {
    status.textContent = "Unable to export edits. Check browser storage and try again.";
  }
});

const rawBaseUrl = window.maculaScriptaConfig?.rawManuscriptBaseUrl;
if (rawBaseUrl) {
  document.querySelectorAll(".manuscript-source[data-raw-path]").forEach(async (source) => {
    try {
      const base = new URL(rawBaseUrl);
      const path = source.dataset.rawPath.split("/").map(encodeURIComponent).join("/");
      const url = new URL(path, base);
      const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
      if (url.origin !== base.origin || !url.pathname.startsWith(basePath)) {
        throw new Error("Manuscript path must stay within the configured base URL.");
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to fetch manuscript: ${response.status}`);
      source.dispatchEvent(new CustomEvent("manuscriptloaded", { detail: await response.text() }));
    } catch (error) {
      source.dispatchEvent(new CustomEvent("manuscriptloaderror", { detail: error.message }));
    }
  });
}
