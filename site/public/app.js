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

function updateCard(card, text) {
  const target = card.querySelector(".ruby-base") ?? card.querySelector(".target-text");
  target.textContent = text;
  card.querySelector(".edit-token").setAttribute("aria-label", `Edit ${text}`);
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
document.querySelectorAll(".edit-token").forEach((button) => {
  button.addEventListener("click", async () => {
    await editsReady;
    if (saving) return;
    const card = button.closest(".token-card");
    const target = card.querySelector(".ruby-base") ?? card.querySelector(".target-text");
    const replacement = window.prompt("Edit translation token", target.textContent);
    if (replacement === null || replacement.trim() === "" || replacement.trim() === target.textContent.trim()) return;

    const ids = new Set(maculaIds(card));
    const affectedCards = sharedEdits?.checked
      ? cards.filter((candidate) => candidate === card || maculaIds(candidate).some((id) => ids.has(id)))
      : [card];
    const updatedAt = new Date().toISOString();
    const edits = affectedCards.map((affected) => ({
      id: cardId(affected),
      verseReference: affected.closest(".verse").dataset.verse,
      alignmentId: affected.dataset.alignmentId,
      targetMaculaIds: maculaIds(affected),
      targetText: replacement.trim(),
      updatedAt
    }));
    saving = true;
    try {
      await saveEdits(edits);
      cards.forEach((candidate) => candidate.classList.remove("recently-edited"));
      affectedCards.forEach((affected) => {
        updateCard(affected, replacement.trim());
        affected.classList.add("recently-edited");
      });
      status.textContent = `Saved ${affectedCards.length} card${affectedCards.length === 1 ? "" : "s"} offline. Recently edited cards are shaded.`;
    } catch {
      status.textContent = "Unable to save this edit. No cards were changed. Check browser storage and try again.";
    } finally {
      saving = false;
    }
  });
});

document.querySelector("#export-edits")?.addEventListener("click", async () => {
  const patch = new Blob([JSON.stringify(await readEdits(), null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(patch);
  const link = document.createElement("a");
  link.href = url;
  link.download = "macula-scripta-edits.json";
  link.click();
  URL.revokeObjectURL(url);
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
