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
const tsv = readFileSync(root("data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv"), "utf8").replace(/\n$/, "").split("\n");
const fields = tsv[0].split("\t");
const chapterRows = new Map();
for (const line of tsv.slice(1)) {
  const row = line.split("\t");
  const [code, rest] = row[1].split(" ");
  const key = `${code}/${rest.split(":")[0]}`;
  if (!chapterRows.has(key)) chapterRows.set(key, []);
  chapterRows.get(key).push(row);
}
const built = existsSync(root("site/public/nt-data/JHN/1.tsv"));

function runScript(stored = new Map(), storageUnavailable = false) {
  const theme = { value: "", events: {}, addEventListener(name, handler) { this.events[name] = handler; } };
  const document = {
    documentElement: { dataset: {} },
    addEventListener() {},
    body: { dataset: { workerUrl: "/MaculaScripta/sw.js" } },
    querySelector: (selector) => (selector === "#reader-theme" ? theme : null)
  };
  let workerUrl;
  const context = {
    document,
    localStorage: {
      getItem(key) { if (storageUnavailable) throw new Error("blocked"); return stored.get(key); },
      setItem(key, value) { if (storageUnavailable) throw new Error("blocked"); stored.set(key, value); }
    },
    navigator: { serviceWorker: { register(url) { workerUrl = url; return Promise.resolve(); } } }
  };
  vm.runInNewContext(script, context);
  return { theme, document, stored, context, workerUrl: () => workerUrl };
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

test("the TSV covers every catalog chapter", () => {
  assert.equal(catalog.length, 27);
  for (const { code, chapters } of catalog) {
    for (let number = 1; number <= chapters; number++) assert(chapterRows.has(`${code}/${number}`), `${code} ${number}`);
  }
  assert.equal(tsv.length - 1, [...chapterRows.values()].reduce((sum, rows) => sum + rows.length, 0));
});

test("chapterModel groups published rows by verse and rebuilds the plain text", () => {
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
    assert(!html.includes("data-chapter-url"));
  }
  const shell = page("nt/1JN/2/index.html");
  assert(shell.includes("data-chapter-url=/MaculaScripta/nt-data/1JN/2.tsv") || shell.includes('data-chapter-url="/MaculaScripta/nt-data/1JN/2.tsv"'));
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
