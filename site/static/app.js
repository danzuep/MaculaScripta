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

async function saveEdit(edit) {
  const database = await openEditDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(edit);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
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

document.querySelectorAll(".edit-token").forEach((button) => {
  button.addEventListener("click", async () => {
    const card = button.closest(".token-card");
    const target = card.querySelector(".target-text");
    const replacement = window.prompt("Edit translation token", target.textContent);
    if (replacement === null || replacement.trim() === "") return;

    const edit = {
      id: `${card.closest(".verse").dataset.verse}:${card.dataset.alignmentId}`,
      verseReference: card.closest(".verse").dataset.verse,
      alignmentId: card.dataset.alignmentId,
      targetMaculaIds: card.dataset.maculaIds.split(",").filter(Boolean),
      targetText: replacement.trim(),
      updatedAt: new Date().toISOString()
    };
    target.textContent = edit.targetText;
    await saveEdit(edit);
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
  document.querySelectorAll(".verse[data-raw-path]").forEach(async (verse) => {
    const path = verse.dataset.rawPath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(new URL(path, rawBaseUrl));
    if (!response.ok) throw new Error(`Unable to fetch manuscript: ${response.status}`);
    verse.dispatchEvent(new CustomEvent("manuscriptloaded", { detail: await response.text() }));
  });
}
