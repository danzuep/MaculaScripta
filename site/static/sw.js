const shellCacheName = "macula-scripta-v13-shell";
const readerCacheName = "macula-scripta-v13-reader";
let offlineMode = false;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCacheName);
    const shell = ["", "demo/", "nt/JHN/", "john-1-1/", "reader.css", "reader.js", "styles.css", "transformation.css", "app.js",
      "transformation.js", "audio-recorder.js", "verse-clipper.js", "audio-coverage.js", "lift-exchange.js", "manifest.webmanifest"];
    await cache.addAll(shell.map((path) => new URL(path, self.registration.scope).href));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const activeCaches = new Set([shellCacheName, readerCacheName]);
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("macula-scripta-") && !activeCaches.has(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Pages and chapter fragments are cached for offline reading only while offline mode is on.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "SET_OFFLINE_MODE") return;
  offlineMode = Boolean(event.data.enabled);
  if (!offlineMode) {
    event.waitUntil(caches.delete(readerCacheName));
    return;
  }
  event.waitUntil((async () => {
    const cache = await caches.open(readerCacheName);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      try {
        const response = await fetch(client.url);
        if (response.ok && response.headers.get("content-type")?.includes("text/html")) await cache.put(client.url, response);
      } catch (error) {
        console.warn("Could not cache an open reader page for offline mode.", error);
      }
    }));
  })());
});

const isChapterData = (url) => /\/(?:nt|ot)-data\/[A-Z0-9]{3}\/\d+\.html$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (isChapterData(url) || event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok && offlineMode) await (await caches.open(readerCacheName)).put(event.request, response.clone());
        return response;
      } catch (error) {
        const cached = await (await caches.open(readerCacheName)).match(event.request)
          ?? await (await caches.open(shellCacheName)).match(event.request);
        if (cached) return cached;
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
