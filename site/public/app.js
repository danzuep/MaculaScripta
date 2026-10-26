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
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "light" ? "#f1f5f9" : "#0f172a");
}

if (theme) {
  theme.value = readSetting("theme") === "light" ? "light" : "dark";
  applyTheme(theme.value);
  theme.addEventListener("change", () => {
    applyTheme(theme.value);
    saveSetting("theme", theme.value);
  });
}

if (sharedEdits) {
  sharedEdits.checked = readSetting("shared-edits") !== "false";
  sharedEdits.addEventListener("change", () => saveSetting("shared-edits", String(sharedEdits.checked)));
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
  card.querySelector(".record-token")?.setAttribute("aria-label", `Record pronunciation for ${text}`);
}

const editsReady = readEdits().then((edits) => {
  const editsById = new Map(edits.map((edit) => [edit.id, edit]));
  cards.forEach((card) => {
    const edit = editsById.get(cardId(card));
    if (edit) updateCard(card, edit.targetText);
  });
}).catch(() => {
  status.textContent = "Saved offline edits could not be loaded. Browser storage may be unavailable.";
});

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

document.querySelectorAll(".edit-token").forEach((button) => {
  button.addEventListener("click", async () => {
    await editsReady;
    if (saving || editor.open) return;
    editingCard = button.closest(".token-card");
    editTrigger = button;
    const target = editingCard.querySelector(".ruby-base") ?? editingCard.querySelector(".target-text");
    editorValue.value = target.textContent.trim();
    editorError.textContent = "";
    document.querySelector("#text-editor-context").textContent =
      `${editingCard.closest(".verse").dataset.verse} · ${editingCard.dataset.language}`;
    const count = affectedCardsFor(editingCard).length;
    document.querySelector("#text-editor-scope").textContent = count > 1
      ? `This will update ${count} cards with the same language, lemma, and word sense. Pronunciation annotations are preserved.`
      : "Only this card will change. Pronunciation annotations are preserved.";
    document.dispatchEvent(new Event("workspaceediting"));
    editor.showModal();
    editorValue.focus();
    editorValue.select();
  });
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
  if (!replacement) {
    editorError.textContent = "Enter translation text before saving.";
    editorValue.focus();
    return;
  }
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
