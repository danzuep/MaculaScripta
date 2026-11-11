// IndexedDB storage for the audio workflow: recorded clips keyed by lemma, plus the language and grammar state.
const databaseName = "macula-scripta-audio";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("clips", { keyPath: "lemma" });
      request.result.createObjectStore("state");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const databasePromise = openDatabase();

async function run(store, mode, action) {
  const database = await databasePromise;
  return new Promise((resolve, reject) => {
    const request = action(database.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadClips() {
  const rows = await run("clips", "readonly", (store) => store.getAll());
  return new Map(rows.map(({ lemma, blob, mime }) => [lemma, { blob, mime }]));
}

export const saveClip = (lemma, blob) => run("clips", "readwrite", (store) => store.put({ lemma, blob, mime: blob.type, saved: Date.now() }));

export async function loadState() {
  const saved = await run("state", "readonly", (store) => store.get("main"));
  return { language: "", rules: {}, seedOrders: {}, ...saved };
}

export const saveState = (state) => run("state", "readwrite", (store) => store.put(state, "main"));
