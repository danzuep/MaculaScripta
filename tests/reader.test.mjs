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
const built = existsSync(root("site/public/nt-data/1JN/1.json"));

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
  const rows = chapterRows.get("1JN/1");
  const model = chapterModel({ fields, words: rows });
  assert.equal(model.verses.length, 10);
  assert.equal(model.verses.flatMap((verse) => verse.words).length, rows.length);
  assert.equal(model.verses[0].words[0].text, rows[0][fields.indexOf("text")]);
  assert.equal(model.verses[0].words[0].verse, "1");
  assert.equal(model.verses[0].words[0].position, "1");
  assert.match(model.verses[0].plain, /^Ὃ ἦν ἀπ’ ἀρχῆς,/);
});

test("1 John is preloaded as complete HTML, other books are client-loaded", { skip: !built && "run hugo --source ./site first" }, () => {
  for (let number = 1; number <= 5; number++) {
    const html = page(`nt/1JN/${number === 1 ? "" : `${number}/`}index.html`);
    const rows = chapterRows.get(`1JN/${number}`);
    assert.equal([...html.matchAll(/<ruby class="?reader-word"?>/g)].length, rows.length);
    assert.equal([...html.matchAll(/<aside class="?reader-def"? /g)].length, rows.length);
    assert(!html.includes("data-chapter-url"));
  }
  const shell = page("nt/JHN/2/index.html");
  assert(shell.includes("data-chapter-url=/MaculaScripta/nt-data/JHN/2.json") || shell.includes('data-chapter-url="/MaculaScripta/nt-data/JHN/2.json"'));
  assert(!shell.includes("reader-word"));
  assert.match(page("nt/JHN/21/index.html"), /Next chapter: Acts 1/);
  assert.match(page("nt/1JN/5/index.html"), /Next chapter: 2 John 1/);
});

test("every chapter is published as JSON matching the TSV", { skip: !built && "run hugo --source ./site first" }, () => {
  for (const [key, rows] of chapterRows) {
    const json = JSON.parse(readFileSync(root(`site/public/nt-data/${key}.json`), "utf8"));
    assert.deepEqual(json.fields, fields, key);
    assert.deepEqual(json.words, rows, key);
  }
  const john = JSON.parse(readFileSync(root("site/public/nt-data/JHN/1.json"), "utf8"));
  assert.equal(john.details.n43001001001, "Preposition");
});
