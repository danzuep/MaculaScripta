// Pure logic for the audio workflow: which cards to record, which verses are complete, how to play a verse in the
// target language's order, and the export manifest. Tokens are { verse, surface, lemma, pos, type, role, gloss, case, mood }.
import { chunkWords, reorderChunks } from "./grammar-order.js";

export const steps = [
  { id: "language", label: "Language" },
  { id: "books", label: "Books" },
  { id: "export", label: "Export" },
  { id: "settings", label: "Settings" }
];

export const manifestFormat = "macula-scripta-audio";

export function toToken([verse, surface, lemma, pos, type, role, gloss, grammaticalCase, mood]) {
  return { verse: verse.split("!")[0], surface, lemma, pos, type, role, gloss, case: grammaticalCase, mood };
}

export const isProperNoun = (token) => token.type === "proper" || token.pos === "proper_noun";

// Distinct lemmas of a verse in reading order; proper nouns keep their original audio and need no card, and
// `unspoken` lemmas (words the target language leaves out) are neither recorded nor played.
export function verseLemmas(words, unspoken = {}) {
  const seen = new Set();
  const lemmas = [];
  for (const word of words) {
    if (isProperNoun(word) || unspoken[word.lemma] || seen.has(word.lemma)) continue;
    seen.add(word.lemma);
    lemmas.push({ lemma: word.lemma, gloss: word.gloss ?? "" });
  }
  return lemmas;
}

export function bookCards(plan, book, unspoken = {}) {
  return plan.cards.filter((card) => card.book === book && !unspoken[card.greek]);
}

// Orders a book's cards chapter by chapter so a whole chapter can be played as early as possible: each chapter
// contributes the cards it needs for the first time, most frequent in that chapter first. Cards that never occur
// in `verses` keep their plan order at the end.
export function chapterOrder(cards, verses) {
  const byLemma = new Map(cards.map((card) => [card.greek, card]));
  const chapters = new Map();
  for (const { verse, words } of verses) {
    const chapter = Number(verse.split(" ")[1].split(":")[0]);
    const counts = chapters.get(chapter) ?? new Map();
    for (const word of words) if (byLemma.has(word.lemma)) counts.set(word.lemma, (counts.get(word.lemma) ?? 0) + 1);
    chapters.set(chapter, counts);
  }
  const ordered = [];
  const placed = new Set();
  for (const chapter of [...chapters.keys()].sort((a, b) => a - b)) {
    const fresh = [...chapters.get(chapter)].filter(([lemma]) => !placed.has(lemma));
    fresh.sort((a, b) => b[1] - a[1]);
    for (const [lemma] of fresh) {
      placed.add(lemma);
      ordered.push({ ...byLemma.get(lemma), chapter });
    }
  }
  return [...ordered, ...cards.filter((card) => !placed.has(card.greek))];
}

export function nextBook(plan, clips, unspoken = {}) {
  return plan.stages.find((stage) => bookCards(plan, stage.book, unspoken).some((card) => !clips.has(card.greek)))?.book ?? plan.stages.at(-1)?.book;
}

export function verseStatus(words, clips, unspoken = {}) {
  const missing = verseLemmas(words, unspoken).filter(({ lemma }) => !clips.has(lemma)).map(({ lemma }) => lemma);
  return { complete: missing.length === 0 && words.some((word) => !isProperNoun(word)), missing };
}

// Words to play for a verse, in the target order: the hand-made chunk order when set, otherwise the learned rules.
export function playbackWords(words, rules, explicitOrder, unspoken = {}) {
  const chunks = chunkWords(words);
  const valid = Array.isArray(explicitOrder) && explicitOrder.length === chunks.length
    && new Set(explicitOrder).size === chunks.length && explicitOrder.every((index) => chunks[index]);
  const order = valid ? explicitOrder : reorderChunks(chunks, rules ?? {});
  return order.flatMap((index) => chunks[index].words).filter((word) => !isProperNoun(word) && !unspoken[word.lemma]);
}

export const playbackLemmas = (...args) => playbackWords(...args).map((word) => word.lemma);

export function groupVerses(tokens) {
  const verses = [];
  let current;
  for (const token of tokens) {
    if (current?.verse !== token.verse) {
      current = { verse: token.verse, words: [] };
      verses.push(current);
    }
    current.words.push(token);
  }
  return verses;
}

const extensionOf = (mime) => {
  const type = (mime || "").split(";")[0];
  return { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav", "audio/mpeg": "mp3" }[type] ?? "bin";
};

const maxPartClips = 1500;
const maxPartBytes = 96 * 1024 * 1024;

// Archive layout: manifest.json (the rules file for scripts/apply-grammar-order.mjs reads its "rules") and clips/<n>.<ext>.
// Large recordings are split into several archives, each with its own manifest, so they stay within the ZIP safety limits.
export function buildExportParts({ language, rules, seedOrders, clips, unspoken = {} }) {
  const parts = [];
  let current;
  let bytes = 0;
  let number = 0;
  for (const [lemma, clip] of clips) {
    if (!current || current.length >= maxPartClips || bytes + clip.blob.size > maxPartBytes) {
      current = [];
      parts.push(current);
      bytes = 0;
    }
    number += 1;
    bytes += clip.blob.size;
    current.push({ lemma, file: `clips/${number}.${extensionOf(clip.mime)}`, mime: clip.mime, blob: clip.blob });
  }
  return parts.map((entries) => ({
    manifest: {
      format: manifestFormat, version: 1, language, rules, seed_orders: seedOrders, unspoken: Object.keys(unspoken).filter((lemma) => unspoken[lemma]),
      clips: entries.map(({ lemma, file, mime }) => ({ lemma, file, mime }))
    },
    files: new Map(entries.map((entry) => [entry.file, entry.blob]))
  }));
}

// Validates an imported manifest and returns { language, rules, seedOrders, clips: [{ lemma, file, mime }] }.
export function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }
  if (data?.format !== manifestFormat || data.version !== 1) throw new Error("This is not a MaculaScripta audio export.");
  if (!Array.isArray(data.clips)) throw new Error("The export has no clip list.");
  const clips = data.clips.filter((clip) => typeof clip?.lemma === "string" && clip.lemma && typeof clip.file === "string");
  return {
    language: typeof data.language === "string" ? data.language : "",
    rules: data.rules && typeof data.rules === "object" ? data.rules : {},
    seedOrders: data.seed_orders && typeof data.seed_orders === "object" ? data.seed_orders : {},
    unspoken: Array.isArray(data.unspoken) ? Object.fromEntries(data.unspoken.filter((lemma) => typeof lemma === "string").map((lemma) => [lemma, true])) : {},
    clips: clips.map(({ lemma, file, mime }) => ({ lemma, file, mime: typeof mime === "string" ? mime : "audio/webm" }))
  };
}
