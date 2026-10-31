import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const page = (path) => readFileSync(root(`site/public/${path}`), "utf8");
const script = readFileSync(root("site/static/reader.js"), "utf8");
const catalog = [...readFileSync(root("site/data/nt/catalog.yaml"), "utf8").matchAll(/- code: (\w+)\n {2}title: (.+)\n {2}chapters: (\d+)/g)]
  .map(([, code, title, chapters]) => ({ code, title, chapters: Number(chapters) }));
const tsvPath = root("data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv");
const hasData = existsSync(tsvPath);
const noData = !hasData && "run git submodule update --init first";
const tsv = hasData ? readFileSync(tsvPath, "utf8").replace(/\n$/, "").split("\n") : [""];
const fields = tsv[0].split("\t");
const chapterRows = new Map();
for (const line of tsv.slice(1)) {
  const row = line.split("\t");
  const [code, rest] = row[1].split(" ");
  const key = `${code}/${rest.split(":")[0]}`;
  if (!chapterRows.has(key)) chapterRows.set(key, []);
  chapterRows.get(key).push(row);
}
const built = hasData && existsSync(root("site/public/nt/JHN/index.html"));

function runScript(stored = new Map(), storageUnavailable = false, systemLight = false) {
  const theme = { checked: false, events: {}, addEventListener(name, handler) { this.events[name] = handler; } };
  const document = {
    documentElement: { dataset: {} },
    addEventListener() {},
    body: { dataset: { workerUrl: "/MaculaScripta/sw.js" } },
    querySelectorAll: () => [],
    querySelector: (selector) => (selector === "#reader-theme" ? theme : null)
  };
  let workerUrl;
  const context = {
    document,
    localStorage: {
      getItem(key) { if (storageUnavailable) throw new Error("blocked"); return stored.get(key); },
      setItem(key, value) { if (storageUnavailable) throw new Error("blocked"); stored.set(key, value); }
    },
    matchMedia: () => ({ matches: systemLight }),
    navigator: { serviceWorker: {
      register(url) { workerUrl = url; return Promise.resolve(); },
      ready: Promise.resolve({ active: { postMessage() {} } }),
      addEventListener() {}
    } }
  };
  vm.runInNewContext(script, context);
  return { theme, document, stored, context, workerUrl: () => workerUrl };
}

test("theme preference is restored, saved, and tolerates blocked storage", () => {
  const app = runScript(new Map([["macula-scripta-theme", "light"]]));
  assert.equal(app.theme.checked, false);
  assert.equal(app.document.documentElement.dataset.theme, "light");
  app.theme.checked = true;
  app.theme.events.change();
  assert.equal(app.stored.get("macula-scripta-theme"), "dark");
  assert.equal(app.workerUrl(), "/MaculaScripta/sw.js");
  const blocked = runScript(new Map(), true);
  blocked.theme.checked = false;
  blocked.theme.events.change();
  assert.equal(blocked.document.documentElement.dataset.theme, "light");
  const system = runScript(new Map(), false, true);
  assert.equal(system.theme.checked, false);
  assert.equal(system.document.documentElement.dataset.theme, "light");
  assert.equal(runScript().theme.checked, true);
});

test("the TSV covers every catalog chapter", { skip: noData }, () => {
  assert.equal(catalog.length, 27);
  for (const { code, chapters } of catalog) {
    for (let number = 1; number <= chapters; number++) assert(chapterRows.has(`${code}/${number}`), `${code} ${number}`);
  }
  assert.equal(tsv.length - 1, [...chapterRows.values()].reduce((sum, rows) => sum + rows.length, 0));
});

test("nextChapter continues through chapters, into the next book, and stops after Revelation", () => {
  const { nextChapter } = runScript().context.MaculaReader;
  const catalog = "JHN:21 ACT:28 REV:22";
  assert.equal(JSON.stringify(nextChapter(catalog, "JHN", 3)), JSON.stringify({ code: "JHN", number: 4 }));
  assert.equal(JSON.stringify(nextChapter(catalog, "JHN", 21)), JSON.stringify({ code: "ACT", number: 1 }));
  assert.equal(nextChapter(catalog, "REV", 22), null);
  assert.equal(nextChapter(catalog, "XXX", 1), null);
});

const count = (html, pattern) => [...html.matchAll(pattern)].length;

test("every chapter is a static page with one flowing paragraph and a pane per word", { skip: !built && "run hugo --source ./site first" }, () => {
  for (const [key, rows] of chapterRows) {
    const [code, number] = key.split("/");
    const html = page(`nt/${code}/${number === "1" ? "" : `${number}/`}index.html`);
    {
      const markup = html;
      assert.equal(count(markup, /<ruby class="?reader-word"?>/g), rows.length, key);
      assert.equal(count(markup, /<aside class="?reader-def"? /g), rows.length, key);
      assert.equal(count(markup, /<span class="?reader-token"?>/g), rows.length, key);
    }
    assert(!html.includes("data-chapter-url="), key);
  }
  assert.match(page("nt/JHN/21/index.html"), /Next chapter: Acts 1/);
  assert.match(page("nt/1JN/5/index.html"), /Next chapter: 2 John 1/);
  assert.doesNotMatch(page("nt/JHN/index.html"), /<dt>(part_of_speech|definition)<\/dt>/);
});

test("Hebrew chapters render right-to-left, continuing from Malachi into Matthew", { skip: !built && "run hugo --source ./site first" }, () => {
  const html = page("ot/HAG/index.html");
  assert.match(html, /<p class="?reader-flow"? lang=hbo dir=rtl>/);
  assert.match(html, /Next chapter: Haggai 2/);
  assert.match(page("ot/HAG/2/index.html"), /Next chapter: (Zechariah|Matthew) 1/);
  assert.match(page("nt/MAT/index.html"), /data-book-code=MAT/);
});

test("verse numbers sit in one flowing paragraph per chapter, and words are inline-block tokens", { skip: !built && "run hugo --source ./site first" }, () => {
  const html = page("nt/JHN/index.html");
  assert.equal([...html.matchAll(/<p class="?reader-flow"?/g)].length, 1);
  assert.equal([...html.matchAll(/<sup class="?verse-number"?>/g)].length, 51);
  assert.match(readFileSync(root("site/static/reader.css"), "utf8"), /\.reader-token \{ display: inline-block;/);
});

test("reader includes the two-step book picker, settings tiles, and verse references", { skip: !built && "run hugo --source ./site first" }, () => {
  const html = page("nt/JHN/index.html");
  assert.ok([...html.matchAll(/reader-book-tile/g)].length >= 28);
  assert.match(html, /<details class="?reader-testament"? data-testament=ot>/);
  assert.match(html, /<details class="?reader-testament"? data-testament=nt open>/);
  assert.match(html, /data-book-code=JHN[^>]*aria-current=true/);
  assert.match(html, /class="?reader-settings-switch"?/);
  assert.match(html, />⋯<\/span>/);
  assert.match(html, /class="?reader-settings-columns"?/);
  assert.match(html, /reader-setting-link/);
  assert.match(html, /id="?reader-full-book-names"?[^>]+class=reader-toggle-input/);
  assert.match(html, /id="?reader-offline"?[^>]+class=reader-toggle-input/);
  assert.match(html, /class="?reader-picker-index"?[^>]*>John 1<\/button>/);
  assert.match(html, /class="?reader-copy"?[^>]*aria-label="Copy plain Greek text"/);
  assert.match(html, /class="?reader-picker-bar"?/);
  assert.match(html, /data-ref="?JHN\/1:1"?/);
  assert.match(readFileSync(root("site/static/reader.css"), "utf8"), /\.reader-grid-tile \{[^}]*aspect-ratio: 1;/);
  assert.match(readFileSync(root("site/static/reader.css"), "utf8"), /\.reader-picker-bar \{ position: fixed;/);
});
