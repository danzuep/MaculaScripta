import assert from "node:assert/strict";
import test from "node:test";
import { chunkWords, learnRules, reorderChunks, reorderDataset } from "../site/static/grammar-order.js";

const w = (surface, pos, extra = {}) => ({ surface, lemma: surface, pos, gloss: surface, ...extra });
const verse = [w("ἀγαπήσεις", "verb"), w("τὸν", "det", { case: "accusative" }), w("θεόν", "noun", { case: "accusative" }),
  w("ἐν", "prep"), w("τῇ", "det", { case: "dative" }), w("καρδίᾳ", "noun", { case: "dative" })];

test("chunks use MACULA class, case and mood", () => {
  const slots = chunkWords([...verse, w("λέγων", "verb", { mood: "participle" }), w("σου", "pron", { case: "genitive" })]);
  assert.deepEqual(slots.map((chunk) => chunk.slot), ["V", "NP.acc", "PP", "PTC", "NP.gen"]);
  assert.deepEqual(slots[2].words.map((word) => word.surface), ["ἐν", "τῇ", "καρδίᾳ"]);
});

test("a learned verb-final order is applied to other verses", () => {
  const chunks = chunkWords(verse);
  const rules = learnRules([{ chunks, order: [1, 2, 0] }]);
  assert.deepEqual(reorderChunks(chunks, rules), [1, 2, 0]);
  const other = reorderDataset([{ verse: "X 1:1", ...w("δός", "verb") }, { verse: "X 1:1", ...w("ἄρτον", "noun", { case: "accusative" }) }], rules);
  assert.deepEqual(other[0].target_order.map((word) => word.surface), ["ἄρτον", "δός"]);
});

test("unseen slot pairs and other clauses keep Greek order", () => {
  const chunks = chunkWords([w("καὶ", "conj"), w("ἦλθεν", "verb"), w("ὁ", "det", { case: "nominative" }), w("υἱὸς", "noun", { case: "nominative" })]);
  assert.deepEqual(reorderChunks(chunks, {}), [0, 1, 2]);
  const rules = learnRules([{ chunks, order: [0, 2, 1] }]);
  assert.deepEqual(reorderChunks(chunks, rules), [0, 2, 1]);
});
