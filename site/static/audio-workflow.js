// Pure logic for the audio workflow: which cards to record, which verses are complete, how to play a verse in the
// target language's order, and the export manifest. Tokens are { verse, surface, lemma, pos, type, role, gloss, case, mood }.
import { chunkWords, reorderChunks } from "./grammar-order.js";

export const steps = [
  { id: "language", label: "Language" },
  { id: "seed", label: "Sample verses" },
  { id: "grammar", label: "Grammar" },
  { id: "books", label: "Books" },
  { id: "export", label: "Export" }
];

export const manifestFormat = "macula-scripta-audio";

export function toToken([verse, surface, lemma, pos, type, role, gloss, grammaticalCase, mood]) {
  return { verse: verse.split("!")[0], surface, lemma, pos, type, role, gloss, case: grammaticalCase, mood };
}

export const isProperNoun = (token) => token.type === "proper" || token.pos === "proper_noun";

// Distinct lemmas of a verse in reading order; proper nouns keep their original audio and need no card.
export function verseLemmas(words) {
  const seen = new Set();
  const lemmas = [];
  for (const word of words) {
    if (isProperNoun(word) || seen.has(word.lemma)) continue;
    seen.add(word.lemma);
    lemmas.push({ lemma: word.lemma, gloss: word.gloss ?? "" });
  }
  return lemmas;
}

// Cards for the sample verses, de-duplicated across verses, with the verses that use them.
export function seedCards(seeds) {
  const cards = new Map();
  for (const seed of seeds) {
    for (const { lemma, gloss } of verseLemmas(seed.words)) {
      const card = cards.get(lemma) ?? { greek: lemma, gloss, verses: [] };
      card.verses.push(seed.verse);
      cards.set(lemma, card);
    }
  }
  return [...cards.values()];
}

export function bookCards(plan, book) {
  return plan.cards.filter((card) => card.book === book);
}

export function nextBook(plan, clips) {
  return plan.stages.find((stage) => bookCards(plan, stage.book).some((card) => !clips.has(card.greek)))?.book ?? plan.stages.at(-1)?.book;
}

export function verseStatus(words, clips) {
  const missing = verseLemmas(words).filter(({ lemma }) => !clips.has(lemma)).map(({ lemma }) => lemma);
  return { complete: missing.length === 0 && words.some((word) => !isProperNoun(word)), missing };
}

// Lemmas to play for a verse, in the target order: the hand-made chunk order for sample verses, otherwise the learned rules.
export function playbackLemmas(words, rules, explicitOrder) {
  const chunks = chunkWords(words);
  const valid = Array.isArray(explicitOrder) && explicitOrder.length === chunks.length
    && new Set(explicitOrder).size === chunks.length && explicitOrder.every((index) => chunks[index]);
  const order = valid ? explicitOrder : reorderChunks(chunks, rules ?? {});
  return order.flatMap((index) => chunks[index].words).filter((word) => !isProperNoun(word)).map((word) => word.lemma);
}

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
export function buildExportParts({ language, rules, seedOrders, clips }) {
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
      format: manifestFormat, version: 1, language, rules, seed_orders: seedOrders,
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
    clips: clips.map(({ lemma, file, mime }) => ({ lemma, file, mime: typeof mime === "string" ? mime : "audio/webm" }))
  };
}
