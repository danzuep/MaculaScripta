import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(new URL("../site/static/reader.js", import.meta.url), "utf8");
const book = JSON.parse(readFileSync(new URL("../site/data/nt/books/1JN.yaml", import.meta.url), "utf8"));
const chapter = JSON.parse(readFileSync(new URL("../site/data/nt/chapters/1JN/c1.yaml", import.meta.url), "utf8"));
book.chapters = [chapter];

class Element {
  constructor() {
    this.children = [];
    this.options = [];
    this.dataset = {};
    this.events = {};
    this.attributes = {};
    this.hidden = true;
    this.textContent = "";
    this.value = "";
  }
  append(...items) { this.children.push(...items); this.options.push(...items); }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...items) { this.children = items; }
  focus() { this.focused = true; }
  set innerHTML(_) { throw new Error("Reader must not inject HTML"); }
}

function reader(source = book, stored = new Map(), storageUnavailable = false) {
  const words = source.chapters.flatMap((chapter) => chapter.verses.flatMap((verse) => verse.words));
  const ids = ["reader-data", "reader-annotation", "reader-theme", "reader-details",
    "reader-details-title", "reader-word-reference", "reader-metadata", "reader", "reader-close-details"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements["reader-data"].textContent = JSON.stringify(source);
  const annotation = elements["reader-annotation"];
  annotation.value = "__gloss";
  annotation.options = ["__gloss", "__mandarin", "__none"].map((value) => ({ value }));
  const buttons = words.map((_, index) => {
    const button = new Element();
    button.dataset.wordIndex = String(index);
    button.rubyText = new Element();
    button.querySelector = () => button.rubyText;
    button.closest = () => button;
    return button;
  });
  const document = new Element();
  document.documentElement = new Element();
  document.body = new Element();
  document.body.dataset.workerUrl = "/MaculaScripta/sw.js";
  document.querySelector = (selector) => elements[selector.slice(1)];
  document.querySelectorAll = () => buttons;
  document.createElement = () => new Element();
  let workerUrl;
  vm.runInNewContext(script, {
    document,
    localStorage: {
      getItem(key) {
        if (storageUnavailable) throw new Error("Storage blocked");
        return stored.get(key);
      },
      setItem(key, value) {
        if (storageUnavailable) throw new Error("Storage blocked");
        stored.set(key, value);
      }
    },
    navigator: { serviceWorker: { register(url) { workerUrl = url; return Promise.resolve(); } } }
  });
  return {
    elements, words, buttons, document, annotation, stored,
    workerUrl: () => workerUrl,
    annotate(value) { annotation.value = value; annotation.events.change(); },
    click(index) { elements.reader.events.click({ target: buttons[index] }); }
  };
}

test("reader defaults to gloss and offers each metadata field exactly once without prefixes", () => {
  const app = reader();
  assert.equal(app.buttons.length, chapter.verses.flatMap((verse) => verse.words).length);
  assert.equal(app.buttons[0].rubyText.textContent, app.words[0].gloss);
  for (const field of new Set(app.words.flatMap(Object.keys))) {
    if (field === "gloss" || field === "mandarin") continue;
    assert(app.annotation.options.some((option) => option.value === `field:${field}`));
  }
  assert(!app.annotation.options.some((option) => ["field:gloss", "field:mandarin"].includes(option.value)));
  const generated = app.annotation.options.filter((option) => option.value.startsWith("field:"));
  assert(generated.every((option) => option.textContent === option.value.slice(6)));
  assert.equal(app.elements["reader-details"].hidden, true);
  assert.equal(app.workerUrl(), "/MaculaScripta/sw.js");
});

test("reader annotation settings support Mandarin, any metadata field, and no annotation", () => {
  const app = reader();
  app.annotate("__mandarin");
  assert.equal(app.buttons[1].rubyText.textContent, app.words[1].mandarin);
  assert.equal(app.buttons[1].rubyText.lang, "zh-Hans");
  app.annotate("field:lemma");
  assert.equal(app.buttons[1].rubyText.textContent, app.words[1].lemma);
  app.annotate("__none");
  assert.equal(app.document.documentElement.dataset.readerAnnotation, "none");
  assert.equal(app.buttons[1].rubyText.textContent, "");
  assert.equal(app.stored.get("macula-scripta-reader-annotation"), "__none");
});

test("one metadata pane shows every field, switches selection, and restores focus on Escape", () => {
  const app = reader();
  app.click(0);
  assert.equal(app.elements["reader-details"].hidden, false);
  assert.equal(app.elements["reader-metadata"].children.length, Object.keys(app.words[0]).length * 2);
  assert.equal(app.buttons[0].attributes["aria-expanded"], "true");
  assert(app.elements["reader-details-title"].focused);
  app.click(1);
  assert.equal(app.buttons[0].attributes["aria-expanded"], "false");
  assert.equal(app.buttons[1].attributes["aria-expanded"], "true");
  let prevented = false;
  app.document.events.keydown({ key: "Escape", preventDefault() { prevented = true; } });
  assert(prevented);
  assert.equal(app.elements["reader-details"].hidden, true);
  assert(app.buttons[1].focused);
  app.click(0);
  app.elements["reader-close-details"].events.click();
  assert.equal(app.elements["reader-details"].hidden, true);
  assert(app.buttons[0].focused);
});

test("preferences restore safely and the reader works with unavailable local storage", () => {
  const app = reader(book, new Map([
    ["macula-scripta-reader-annotation", "field:lemma"],
    ["macula-scripta-theme", "light"]
  ]));
  assert.equal(app.buttons[0].rubyText.textContent, app.words[0].lemma);
  assert.equal(app.document.documentElement.dataset.theme, "light");
  const blocked = reader(book, new Map(), true);
  blocked.annotate("__mandarin");
  blocked.elements["reader-theme"].value = "light";
  blocked.elements["reader-theme"].events.change();
  assert.equal(blocked.document.documentElement.dataset.theme, "light");
  for (const [oldValue, newValue] of [
    ["__english", "__gloss"], ["field:gloss", "__gloss"], ["field:mandarin", "__mandarin"]
  ]) {
    const migrated = reader(book, new Map([["macula-scripta-reader-annotation", oldValue]]));
    assert.equal(migrated.annotation.value, newValue);
  }
});

test("gloss is used independently of english and hostile metadata remains literal text", () => {
  const payload = '</script><img src=x onerror="alert(1)">';
  const word = { text: "λόγος", english: "not the gloss", gloss: payload, ref: "TEST 1:1!1", nested: { value: payload } };
  const app = reader({ chapters: [{ verses: [{ words: [word] }] }] });
  assert.equal(app.buttons[0].rubyText.textContent, payload);
  app.click(0);
  const values = app.elements["reader-metadata"].children.map((element) => element.textContent);
  assert(values.includes(payload));
  assert(values.includes(JSON.stringify(word.nested)));
  app.annotate("field:nested");
  assert.equal(app.buttons[0].rubyText.textContent, JSON.stringify(word.nested));
});

test("built reader preserves every word, verse anchor, and punctuation separator", () => {
  const html = readFileSync(new URL("../site/public/index.html", import.meta.url), "utf8");
  const words = book.chapters.flatMap((chapter) => chapter.verses.flatMap((verse) => verse.words));
  const rendered = [...html.matchAll(/<button class="?reader-word"?\s[^>]*data-word-index="?(\d+)"?[^>]*>[\s\S]*?<\/button>([\s\S]*?)(?=<button class="?reader-word"?\s|<sup|<\/p>)/g)];
  assert.equal(rendered.length, words.length);
  const verseAnchors = [...html.matchAll(/\bid="?verse-(\d+)-(\d+)"?[\s>]/g)];
  assert.equal(verseAnchors.length, 10);
  assert.equal(new Set(verseAnchors.map((match) => `${match[1]}:${match[2]}`)).size, 10);
  const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&#34;").replaceAll("'", "&#39;");
  const chapterEndReferences = new Set(book.chapters.map((chapter) => chapter.verses.at(-1).words.at(-1).ref));
  let punctuationOnly = 0;
  for (const match of rendered) {
    const word = words[Number(match[1])];
    const after = word.after || "";
    let expected = escapeHtml(after) + (/\s$/.test(after) ? "" : " ");
    if (chapterEndReferences.has(word.ref)) expected = expected.trimEnd();
    assert.equal(match[2], expected, `Separator after ${word.ref}`);
    assert(match[0].includes(`<ruby>${escapeHtml(word.text)}<rt`), `Greek word ${word.ref}`);
    if (after && !/\s$/.test(after)) punctuationOnly++;
  }
  assert(punctuationOnly > 0, "Imported punctuation-only separators were exercised");
});

test("every published reader page renders and embeds only its selected chapter", () => {
  const catalog = JSON.parse(readFileSync(new URL("../site/data/nt/catalog.yaml", import.meta.url)));
  for (const entry of catalog.filter((entry) => entry.available)) {
    for (let number = 1; number <= entry.chapters; number++) {
      const path = `nt/${entry.slug}/${number === 1 ? "" : `${number}/`}index.html`;
      const html = readFileSync(new URL(`../site/public/${path}`, import.meta.url), "utf8");
      const match = html.match(/<script id="?reader-data"? type="?application\/json"?>([\s\S]*?)<\/script>/);
      assert(match, path);
      const data = JSON.parse(match[1]);
      assert.equal(data.code, entry.code);
      assert.equal(data.chapters.length, 1, path);
      assert.equal(data.chapters[0].number, number, path);
      const source = JSON.parse(readFileSync(new URL(
        `../site/data/nt/chapters/${entry.code}/c${number}.yaml`, import.meta.url
      )));
      assert.deepEqual(data.chapters[0], source);
      assert.equal([...html.matchAll(/class="?reader-chapter"?[\s>]/g)].length, 1);
      assert.equal([...html.matchAll(/data-word-index=/g)].length,
        source.verses.flatMap((verse) => verse.words).length);
      for (let target = 1; target <= entry.chapters; target++) {
        const href = `/MaculaScripta/nt/${entry.slug}/${target === 1 ? "" : `${target}/`}`;
        assert(html.includes(`href=${href}`) || html.includes(`href="${href}"`), href);
      }
      assert(html.includes('aria-label="Close word details">×</button>'));
    }
  }
});
