import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const site = (path) => fileURLToPath(new URL(`../site/${path}`, import.meta.url));
const readYaml = (path) => JSON.parse(execFileSync("python3", [
  "-c",
  "import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding='utf-8'))))",
  site(path)
], { encoding: "utf8", maxBuffer: 1 << 28 }));
const page = (path) => readFileSync(site(`public/${path}`), "utf8");
const script = readFileSync(site("static/reader.js"), "utf8");
const catalog = readYaml("data/nt/catalog.yaml");
const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&#34;").replaceAll("'", "&#39;");

function runScript(stored = new Map(), storageUnavailable = false) {
  const theme = { value: "", events: {}, addEventListener(name, handler) { this.events[name] = handler; } };
  const document = {
    documentElement: { dataset: {} },
    body: { dataset: { workerUrl: "/MaculaScripta/sw.js" } },
    querySelector: (selector) => (selector === "#reader-theme" ? theme : null)
  };
  let workerUrl;
  vm.runInNewContext(script, {
    document,
    localStorage: {
      getItem(key) { if (storageUnavailable) throw new Error("blocked"); return stored.get(key); },
      setItem(key, value) { if (storageUnavailable) throw new Error("blocked"); stored.set(key, value); }
    },
    navigator: { serviceWorker: { register(url) { workerUrl = url; return Promise.resolve(); } } }
  });
  return { theme, document, stored, workerUrl: () => workerUrl };
}

test("theme preference is restored, saved, and tolerates blocked storage", () => {
  const app = runScript(new Map([["macula-scripta-theme", "light"]]));
  assert.equal(app.theme.value, "light");
  assert.equal(app.document.documentElement.dataset.theme, "light");
  app.theme.value = "dark";
  app.theme.events.change();
  assert.equal(app.stored.get("macula-scripta-theme"), "dark");
  assert.equal(app.workerUrl(), "/MaculaScripta/sw.js");
  const blocked = runScript(new Map(), true);
  blocked.theme.value = "light";
  blocked.theme.events.change();
  assert.equal(blocked.document.documentElement.dataset.theme, "light");
});

test("every published reader page is data-driven, interactive, and JSON-free", () => {
  for (const entry of catalog.filter((entry) => entry.available)) {
    for (let number = 1; number <= entry.chapters; number++) {
      const path = `nt/${entry.code}/${number === 1 ? "" : `${number}/`}index.html`;
      const html = page(path);
      const chapter = readYaml(`data/nt/${entry.code}/${number}.yaml`);
      const words = chapter.verses.flatMap((verse) => verse.words);

      assert(!html.includes("reader-data"), "no embedded JSON");
      assert([...html.matchAll(/class="?reader-chapter"?[\s>]/g)].length === 1, path);
      assert.equal([...html.matchAll(/<ruby class="?reader-word"?>/g)].length, words.length, path);
      assert.equal([...html.matchAll(/<aside class="?reader-def"? /g)].length, words.length, path);
      assert(html.includes('class="reader-ruby-input"') || html.includes("class=reader-ruby-input"), path);
      assert(html.includes("reader-copy"), path);

      const verseAnchors = [...html.matchAll(/\bid="?verse-(\d+)-(\d+)"?[\s>]/g)];
      assert.equal(verseAnchors.length, chapter.verses.length, path);

      const rendered = [...html.matchAll(/<a id="?word-([^" >]+)"? href="?#def-([^" >]+)"?[^>]*>([^<]*)<\/a>[\s\S]*?<\/ruby>([\s\S]*?)(?=<ruby class|<sup|<\/p>)/g)];
      assert.equal(rendered.length, words.length, path);
      const chapterEnd = words.at(-1)["xml:id"];
      rendered.forEach((match, index) => {
        const word = words[index];
        assert.equal(match[1], word["xml:id"]);
        assert.equal(match[2], word["xml:id"]);
        assert.equal(match[3], escapeHtml(word.text));
        const after = word.after || "";
        let expected = escapeHtml(after) + (/\s$/.test(after) ? "" : " ");
        if (word["xml:id"] === chapterEnd) expected = expected.trimEnd();
        assert.equal(match[4], expected, `Separator after ${word.ref}`);
        assert(html.includes(`id=def-${word["xml:id"]}`) || html.includes(`id="def-${word["xml:id"]}"`));
      });

      for (let target = 1; target <= entry.chapters; target++) {
        const href = `/MaculaScripta/nt/${entry.code}/${target === 1 ? "" : `${target}/`}`;
        assert(html.includes(`href=${href}`) || html.includes(`href="${href}"`), href);
      }
      const nextLink = html.match(/<nav class="?reader-next-chapter"?[^>]*>\s*<a href="?([^" >]+)"?[^>]*>Next chapter: ([^<]+)/);
      if (number < entry.chapters) {
        assert(nextLink, path);
        assert.equal(nextLink[1], `/MaculaScripta/nt/${entry.code}/${number + 1}/`);
      } else if (entry.code === "JHN") {
        assert(nextLink, path);
        assert.equal(nextLink[1], "/MaculaScripta/nt/1JN/");
      } else {
        assert.equal(nextLink, null, path);
      }
    }
  }
});

test("copy button carries only the plain Greek text of the chapter", () => {
  const html = page("nt/1JN/index.html");
  const chapter = readYaml("data/nt/1JN/1.yaml");
  const plain = chapter.verses.flatMap((verse) => verse.words)
    .map((word) => `${word.text}${word.after || ""}`).join(" ").replace(/\s+/g, " ").trim();
  const copy = html.match(/<button [^>]*class="?reader-copy"?[^>]*data-text="([^"]*)"/) ||
    html.match(/<button [^>]*data-text="([^"]*)"[^>]*class="?reader-copy"?/);
  assert(copy);
  assert.equal(copy[1].replace(/\s+/g, " ").replaceAll("&#39;", "'"), plain);
});
