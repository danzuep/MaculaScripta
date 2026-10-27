import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAudio, buildCoverageIndex, cellState, recommendVerse, scoreVerse, summarizeCoverage
} from "../site/static/audio-coverage.js";

let nextId = 0;
const word = (verse, text, { audio = false, sense = "" } = {}) => ({
  verse,
  translated: Boolean(text),
  hasAudio: audio,
  keys: [`card:${nextId += 1}`, text && `word:${text}`, sense && `sense:${sense}`].filter(Boolean)
});

test("cell states distinguish untranslated, missing audio and audio", () => {
  assert.equal(cellState(word("v", "")), "untranslated");
  assert.equal(cellState(word("v", "Word")), "missing");
  assert.equal(cellState(word("v", "Word", { audio: true })), "audio");
});

test("effort counts unique keys; impact counts every occurrence filled", () => {
  const index = buildCoverageIndex([
    word("1:1", "Word"), word("1:1", "Word"), word("1:1", "God"), word("1:1", ""),
    word("1:2", "Word"), word("1:2", "God", { audio: true }), word("1:3", "Word")
  ]);
  const score = scoreVerse(index, index.byVerse.get("1:1"));
  assert.equal(score.effort, 2);
  assert.equal(score.impact, 5);
});

test("shared sense keys extend a clip's reach without extra effort", () => {
  const index = buildCoverageIndex([
    word("1:1", "beginning", { sense: "arche" }), word("1:2", "start", { sense: "arche" }),
    word("1:2", "start")
  ]);
  const score = scoreVerse(index, index.byVerse.get("1:1"));
  assert.deepEqual([score.effort, score.impact], [1, 2]);
});

test("recommendation prefers impact, then effort, then document order", () => {
  const byImpact = buildCoverageIndex([
    word("a", "x"), word("b", "y"), word("b", "z"), word("c", "y"), word("c", "z")
  ]);
  assert.equal(recommendVerse(byImpact).verse.key, "b");

  const byEffort = buildCoverageIndex([
    word("a", "x"), word("a", "y"), word("b", "z"), word("b", "z")
  ]);
  const best = recommendVerse(byEffort);
  assert.deepEqual([best.verse.key, best.effort, best.impact], ["b", 1, 2]);

  const byOrder = buildCoverageIndex([word("a", "x"), word("b", "y"), word("c", "x")]);
  assert.equal(recommendVerse(byOrder).verse.key, "a");
});

test("coverage moves from empty to available to complete", () => {
  assert.equal(summarizeCoverage(buildCoverageIndex([])).state, "empty");
  assert.equal(summarizeCoverage(buildCoverageIndex([word("a", "")])).state, "empty");

  const index = buildCoverageIndex([word("a", "Word"), word("b", "Word"), word("b", "God")]);
  let summary = summarizeCoverage(index);
  assert.equal(summary.state, "available");
  assert.deepEqual([summary.recommendation.verse.key, summary.missing], ["b", 3]);

  assert.deepEqual(applyAudio(index, (position) => position < 2), [0, 1]);
  summary = summarizeCoverage(index);
  assert.deepEqual([summary.state, summary.withAudio, summary.recommendation.effort], ["available", 2, 1]);
  assert.deepEqual(applyAudio(index, (position) => position < 2), []);

  applyAudio(index, () => true);
  summary = summarizeCoverage(index);
  assert.equal(summary.state, "complete");
  assert.equal(summary.recommendation, null);
});
