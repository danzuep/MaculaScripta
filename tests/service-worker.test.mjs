import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(fileURLToPath(new URL("../site/static/sw.js", import.meta.url)), "utf8");

class MemoryCache {
  entries = new Map();

  async delete(request) {
    return this.entries.delete(typeof request === "string" ? request : request.url);
  }

  async put(request, response) {
    this.entries.set(typeof request === "string" ? request : request.url, response.clone());
  }

  async match(request) {
    const response = this.entries.get(typeof request === "string" ? request : request.url);
    return response?.clone();
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

function createWorker() {
  const listeners = new Map();
  const cacheStorage = new Map();
  const context = {
    Request,
    Response,
    URL,
    fetch: async (request) => new Response(new URL(request.url).pathname),
    caches: {
      async open(name) {
        if (!cacheStorage.has(name)) cacheStorage.set(name, new MemoryCache());
        return cacheStorage.get(name);
      }
    },
    self: {
      location: { origin: "https://example.test" },
      registration: { scope: "https://example.test/MaculaScripta/" },
      clients: { matchAll: async () => [], claim: async () => {} },
      addEventListener(type, handler) { listeners.set(type, handler); }
    }
  };
  vm.runInNewContext(source, context);

  return {
    cacheStorage,
    async fetchChapter(number) {
      let response;
      listeners.get("fetch")({
        request: new Request(`https://example.test/MaculaScripta/nt-data/JHN/${number}.tsv`),
        respondWith(value) { response = value; }
      });
      return response;
    },
    async fetchPage(number) {
      let response;
      listeners.get("fetch")({
        request: {
          method: "GET",
          mode: "navigate",
          url: `https://example.test/MaculaScripta/nt/JHN/${number === 1 ? "" : `${number}/`}`
        },
        respondWith(value) { response = value; }
      });
      return response;
    },
    async setOfflineMode(enabled) {
      let pending;
      listeners.get("message")({
        data: { type: "SET_OFFLINE_MODE", enabled },
        waitUntil(value) { pending = value; }
      });
      await pending;
    }
  };
}

test("reader page and chapter caches keep three recent entries unless offline mode is enabled", async () => {
  const worker = createWorker();
  for (let number = 1; number <= 4; number++) {
    await worker.fetchChapter(number);
    await worker.fetchPage(number);
  }
  let cache = worker.cacheStorage.get("macula-scripta-v12-chapters");
  assert.deepEqual((await cache.keys()).map((request) => request.url.split("/").at(-1)), ["2.tsv", "3.tsv", "4.tsv"]);
  let pages = worker.cacheStorage.get("macula-scripta-v12-pages");
  assert.deepEqual((await pages.keys()).map((request) => request.url.split("/").filter(Boolean).at(-1)), ["2", "3", "4"]);

  await worker.setOfflineMode(true);
  for (let number = 5; number <= 7; number++) {
    await worker.fetchChapter(number);
    await worker.fetchPage(number);
  }
  assert.equal((await cache.keys()).length, 6);
  assert.equal((await pages.keys()).length, 6);

  await worker.setOfflineMode(false);
  assert.deepEqual((await cache.keys()).map((request) => request.url.split("/").at(-1)), ["5.tsv", "6.tsv", "7.tsv"]);
  assert.deepEqual((await pages.keys()).map((request) => request.url.split("/").filter(Boolean).at(-1)), ["5", "6", "7"]);
});
