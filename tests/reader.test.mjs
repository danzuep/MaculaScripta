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
const built = hasData && existsSync(root("site/public/nt-data/JHN/1.tsv"));

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

test("chapterModel groups published rows by verse and rebuilds the plain text", { skip: noData }, () => {
  const { chapterModel } = runScript().context.MaculaReader;
  const rows = chapterRows.get("JHN/1");
  const model = chapterModel({ fields, words: rows });
  assert.equal(model.verses.length, 51);
  assert.equal(model.verses.flatMap((verse) => verse.words).length, rows.length);
  assert.equal(model.verses[0].words[0].text, rows[0][fields.indexOf("text")]);
  assert.equal(model.verses[0].words[0].verse, "1");
  assert.equal(model.verses[0].words[0].position, "1");
  assert.match(model.verses[0].plain, /^Ἐν ἀρχῇ ἦν ὁ λόγος,/);
});

test("nextChapter continues through chapters, into the next book, and stops after Revelation", () => {
  const { nextChapter } = runScript().context.MaculaReader;
  const catalog = "JHN:21 ACT:28 REV:22";
  assert.equal(JSON.stringify(nextChapter(catalog, "JHN", 3)), JSON.stringify({ code: "JHN", number: 4 }));
  assert.equal(JSON.stringify(nextChapter(catalog, "JHN", 21)), JSON.stringify({ code: "ACT", number: 1 }));
  assert.equal(nextChapter(catalog, "REV", 22), null);
  assert.equal(nextChapter(catalog, "XXX", 1), null);
});

test("parseTsv reads a published chapter file", () => {
  const { parseTsv } = runScript().context.MaculaReader;
  const parsed = parseTsv("a\tb\n1\t\n2\tx\n");
  assert.equal(JSON.stringify(parsed), JSON.stringify({ fields: ["a", "b"], words: [["1", ""], ["2", "x"]] }));
});

test("John is preloaded as complete HTML, other books are client-loaded", { skip: !built && "run hugo --source ./site first" }, () => {
  for (let number = 1; number <= 21; number++) {
    const html = page(`nt/JHN/${number === 1 ? "" : `${number}/`}index.html`);
    const rows = chapterRows.get(`JHN/${number}`);
    assert.equal([...html.matchAll(/<ruby class="?reader-word"?>/g)].length, rows.length);
    assert.equal([...html.matchAll(/<aside class="?reader-def"? /g)].length, rows.length);
    assert.equal([...html.matchAll(/<span class="?reader-token"?>/g)].length, rows.length);
    assert(!html.includes("data-chapter-url="));
  }
  const shell = page("nt/1JN/2/index.html");
  assert.match(shell, /data-chapter-url="?\/MaculaScripta\/nt-data\/1JN\/2\.tsv"?[ >]/);
  assert(!shell.includes("reader-word"));
  assert.match(page("nt/JHN/21/index.html"), /Next chapter: Acts 1/);
  assert.match(page("nt/1JN/5/index.html"), /Next chapter: 2 John 1/);
});

test("every chapter is published as the original TSV plus lookup columns", { skip: !built && "run hugo --source ./site first" }, () => {
  for (const [key, rows] of chapterRows) {
    const [header, ...lines] = readFileSync(root(`site/public/nt-data/${key}.tsv`), "utf8").replace(/\n$/, "").split("\n");
    assert.deepEqual(header.split("\t"), [...fields, "part_of_speech", "definition"], key);
    assert.deepEqual(lines.map((line) => line.split("\t").slice(0, fields.length)), rows, key);
  }
  const [, first] = readFileSync(root("site/public/nt-data/JHN/1.tsv"), "utf8").split("\n");
  assert.equal(first.split("\t").at(-2), "Preposition");
});

test("verse numbers sit in one flowing paragraph per chapter, and words are inline-block tokens", { skip: !built && "run hugo --source ./site first" }, () => {
  const html = page("nt/JHN/index.html");
  assert.equal([...html.matchAll(/<p class="?reader-flow"?/g)].length, 1);
  assert.equal([...html.matchAll(/<sup class="?verse-number"?>/g)].length, 51);
  assert.match(readFileSync(root("site/static/reader.css"), "utf8"), /\.reader-token \{ display: inline-block;/);
});

test("reader includes the two-step book picker, settings tiles, and verse references", { skip: !built && "run hugo --source ./site first" }, () => {
  const html = page("nt/JHN/index.html");
  assert.equal([...html.matchAll(/reader-book-tile/g)].length, 27);
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
  assert.match(readFileSync(root("site/static/reader.css"), "utf8"), /\.reader-picker-bar\.is-floating/);
  assert.match(readFileSync(root("site/static/sw.js"), "utf8"), /maxCachedChapters = 3/);
});
