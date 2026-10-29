const cacheName = "macula-scripta-v9";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const shell = ["", "demo/", "nt/1JN/", "nt/JHN/", "john-1-1/", "reader.css", "reader.js", "styles.css", "transformation.css", "app.js",
      "transformation.js", "audio-recorder.js", "verse-clipper.js", "audio-coverage.js", "lift-exchange.js", "manifest.webmanifest"];
    await cache.addAll(shell.map((path) => new URL(path, self.registration.scope).href));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== cacheName).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
