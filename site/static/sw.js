const shellCacheName = "macula-scripta-v12-shell";
const chapterCacheName = "macula-scripta-v12-chapters";
const pageCacheName = "macula-scripta-v12-pages";
const maxCachedChapters = 3;
let offlineMode = false;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCacheName);
    const shell = ["", "demo/", "nt/JHN/", "nt/1JN/", "john-1-1/", "reader.css", "reader.js", "styles.css", "transformation.css", "app.js",
      "transformation.js", "audio-recorder.js", "verse-clipper.js", "audio-coverage.js", "lift-exchange.js", "manifest.webmanifest"];
    await cache.addAll(shell.map((path) => new URL(path, self.registration.scope).href));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const activeCaches = new Set([shellCacheName, chapterCacheName, pageCacheName]);
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("macula-scripta-") && !activeCaches.has(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SET_OFFLINE_MODE") return;
  offlineMode = Boolean(event.data.enabled);
  if (!offlineMode) {
    event.waitUntil(Promise.all([trimChapterCache(), trimPageCache()]));
    return;
  }
  event.waitUntil((async () => {
    const cache = await caches.open(pageCacheName);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      try {
        const response = await fetch(client.url);
        if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
          await cache.delete(client.url);
          await cache.put(client.url, response);
        }
      } catch (error) {
        console.warn("Could not cache an open reader page for offline mode.", error);
      }
    }));
  })());
});

const isChapterData = (url) => /\/nt-data\/[A-Z0-9]{3}\/\d+\.tsv$/.test(url.pathname);

async function trimChapterCache() {
  await trimCache(chapterCacheName);
}

async function trimPageCache() {
  await trimCache(pageCacheName);
}

async function trimCache(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  while (keys.length > maxCachedChapters) {
    await cache.delete(keys.shift());
  }
}

async function saveChapter(request, response) {
  const cache = await caches.open(chapterCacheName);
  await cache.delete(request);
  await cache.put(request, response.clone());
  if (!offlineMode) await trimChapterCache();
}

async function cachedChapter(request) {
  const cache = await caches.open(chapterCacheName);
  const response = await cache.match(request);
  if (response) {
    await cache.delete(request);
    await cache.put(request, response.clone());
  }
  return response;
}

async function savePage(request, response) {
  const cache = await caches.open(pageCacheName);
  await cache.delete(request);
  await cache.put(request, response.clone());
  if (!offlineMode) await trimPageCache();
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (isChapterData(url)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) await saveChapter(event.request, response);
        return response;
      } catch (error) {
        const cached = await cachedChapter(event.request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) await savePage(event.request, response);
        return response;
      } catch (error) {
        const pageCache = await caches.open(pageCacheName);
        const cachedPage = await pageCache.match(event.request);
        if (cachedPage) return cachedPage;
        const shellCache = await caches.open(shellCacheName);
        const cachedShell = await shellCache.match(event.request);
        if (cachedShell) return cachedShell;
        throw error;
      }
    })());
    return;
  }
  event.respondWith(fetch(event.request).catch(async (error) => {
    const cache = await caches.open(shellCacheName);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw error;
  }));
});
