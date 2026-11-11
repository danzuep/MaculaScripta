import assert from "node:assert/strict";
import test from "node:test";
import { buildExportParts, chapterOrder, parseManifest, bookCards, playbackLemmas, playbackWords, verseStatus } from "../site/static/audio-workflow.js";

const w = (lemma, extra = {}) => ({ surface: lemma, lemma, pos: "noun", type: "common", role: "", gloss: lemma, ...extra });
const clip = (type = "audio/webm") => ({ blob: new Blob(["x"], { type }), mime: type });

test("a verse is playable once all its non-proper lemmas are recorded", () => {
  const words = [w("a"), w("Ἰησοῦς", { type: "proper" }), w("b")];
  assert.deepEqual(verseStatus(words, new Map([["a", clip()]])).missing, ["b"]);
  assert.equal(verseStatus(words, new Map([["a", clip()], ["b", clip()]])).complete, true);
});

test("playback uses a valid explicit order and falls back to Greek order", () => {
  const words = [w("v", { pos: "verb" }), w("n", { pos: "noun", case: "nominative" })];
  assert.deepEqual(playbackLemmas(words, {}, [1, 0]), ["n", "v"]);
  assert.deepEqual(playbackLemmas(words, {}, [0, 0]), ["v", "n"]);
  assert.deepEqual(playbackLemmas(words, {}, undefined), ["v", "n"]);
});

test("export splits into parts and the manifest round-trips", () => {
  const clips = new Map(Array.from({ length: 1501 }, (_, i) => [`l${i}`, clip()]));
  const parts = buildExportParts({ language: "Test", rules: { "V|NP.nominative": { keep: 1, flip: 0 } }, seedOrders: { "A 1:1": [1, 0] }, clips });
  assert.equal(parts.length, 2);
  const parsed = parseManifest(JSON.stringify(parts[0].manifest));
  assert.equal(parsed.language, "Test");
  assert.deepEqual(parsed.seedOrders, { "A 1:1": [1, 0] });
  assert.equal(parsed.clips.length, 1500);
  assert.ok(parts[0].files.has(parsed.clips[0].file));
});

test("imports reject foreign or malformed manifests", () => {
  assert.throws(() => parseManifest("nope"), /valid JSON/);
  assert.throws(() => parseManifest(JSON.stringify({ format: "other", version: 1, clips: [] })), /not a MaculaScripta/);
});

test("unspoken lemmas need no card and are not played", () => {
  const words = [
    { verse: "A 1:1", surface: "ὁ", lemma: "ὁ", pos: "det", type: "", gloss: "the" },
    { verse: "A 1:1", surface: "λόγος", lemma: "λόγος", pos: "noun", type: "common", gloss: "word" }
  ];
  const unspoken = { ὁ: true };
  const plan = { cards: [{ book: "A", greek: "ὁ" }, { book: "A", greek: "λόγος" }] };
  assert.deepEqual(bookCards(plan, "A", unspoken).map((card) => card.greek), ["λόγος"]);
  assert.equal(verseStatus(words, new Map([["λόγος", {}]]), unspoken).complete, true);
  assert.deepEqual(playbackLemmas(words, {}, undefined, unspoken), ["λόγος"]);
  assert.deepEqual(playbackWords(words, {}, undefined, unspoken).map((word) => word.gloss), ["word"]);
  assert.deepEqual(parseManifest(JSON.stringify({ format: "macula-scripta-audio", version: 1, clips: [], unspoken: ["ὁ"] })).unspoken, unspoken);
});

test("chapterOrder lists each chapter's new cards first, most frequent first", () => {
  const cards = ["a", "b", "c", "d"].map((greek) => ({ greek }));
  const word = (lemma) => ({ lemma });
  const ordered = chapterOrder(cards, [
    { verse: "X 2:1", words: [word("c"), word("b"), word("b")] },
    { verse: "X 1:1", words: [word("a"), word("b")] }
  ]);
  assert.deepEqual(ordered.map((card) => card.greek), ["a", "b", "c", "d"]);
  assert.deepEqual(ordered.map((card) => card.chapter), [1, 1, 2, undefined]);
});
