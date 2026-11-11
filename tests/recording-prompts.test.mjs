import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptSet, diphonesOf, koineIpa } from "../site/static/recording-prompts.js";

const word = (surface, lemma = surface, extra = {}) => ({ surface, lemma, pos: "noun", type: "common", verse: "V1", ...extra });

test("Koine G2P maps diphthongs, aspirates and nasal gamma", () => {
  assert.equal(koineIpa("καὶ").join(""), "ke");
  assert.equal(koineIpa("οὐκ").join(""), "uk");
  assert.equal(koineIpa("ἀρχῇ").join(""), "arxi");
  assert.equal(koineIpa("ἄγγελος").join(""), "aŋelos");
  assert.equal(koineIpa("λόγος").join(""), "loɣos");
  assert.equal(koineIpa("αὐτοῦ").join(""), "aftu");
  assert.equal(koineIpa("εὐαγγέλιον").join(""), "evaŋelion");
});

test("a diaeresis keeps vowels separate", () => {
  assert.equal(koineIpa("Ἠσαΐας").join(""), "isaias");
});

test("diphones are adjacent phone pairs", () => {
  assert.deepEqual(diphonesOf(["a", "b", "c"]), ["a-b", "b-c"]);
});

test("proper nouns are excluded and never appear in prompts", () => {
  const result = buildPromptSet([
    word("λόγος"), word("Ἰησοῦ", "Ἰησοῦς", { type: "proper" }), word("ἐστιν"), word("θεός"), word("φῶς")
  ]);
  assert.deepEqual(result.proper_nouns_excluded, [{ surface: "Ἰησοῦ", audio_action: "USE_ORIGINAL_PRONUNCIATION" }]);
  assert.ok(result.recording_queue.length > 0);
  for (const prompt of result.recording_queue) {
    assert.ok(!prompt.phrase_greek.includes("Ἰησοῦ"));
    const words = prompt.phrase_greek.split(" ").length;
    assert.ok(words >= 2 && words <= 3);
    assert.equal(prompt.audio_action, "RECORD_PROMPT");
  }
  assert.ok(!result.recording_queue.some((prompt) => prompt.phrase_greek.includes("λόγος ἐστιν")));
});

test("prompts cover every diphone exactly once and are numbered from 1", () => {
  const tokens = ["ἐν", "ἀρχῇ", "ἦν", "ὁ", "λόγος", "καὶ", "ὁ", "λόγος", "ἦν", "πρὸς", "τὸν", "θεόν"].map((text) => word(text));
  const result = buildPromptSet(tokens);
  const covered = result.recording_queue.flatMap((prompt) => prompt.new_diphones_covered);
  assert.equal(new Set(covered).size, covered.length);
  assert.equal(covered.length, result.summary.total_unique_diphones);
  assert.equal(result.summary.prompts_generated, result.recording_queue.length);
  assert.deepEqual(result.recording_queue.map((prompt) => prompt.prompt_id), result.recording_queue.map((_, index) => index + 1));
  assert.ok(result.summary.estimated_recording_time_minutes > 0);
});

test("phrases do not cross verse boundaries", () => {
  const result = buildPromptSet([word("λόγος", "λόγος", { verse: "V1" }), word("θεός", "θεός", { verse: "V2" })]);
  assert.equal(result.recording_queue.length, 0);
});
