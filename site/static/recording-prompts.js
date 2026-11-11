// Recording prompt set: the fewest 2-3 word Koine phrases that cover every diphone and the most frequent lemmas.
// Pure, dependency-free functions shared by the browser page and the Node generator, so the whole
// pipeline (G2P, diphone extraction, greedy set cover) runs offline. Tokens are
// { surface, lemma, pos, type, verse? } in document order; `verse` keeps phrases from crossing verse boundaries.

export const minWords = 2;
export const maxWords = 3;
export const topLemmaCount = 2000;
const secondsPerSyllable = 0.35;
const secondsPerPrompt = 2.5;

const vowelLetters = "αεηιουω";
const frontVowels = new Set(["ε", "ι", "η", "υ"]);
const voiceless = new Set(["θ", "κ", "ξ", "π", "σ", "τ", "φ", "χ", "ψ"]);
const velar = new Set(["γ", "κ", "ξ", "χ"]);
const letters = {
  β: "v", δ: "ð", ζ: "z", θ: "θ", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "ks", π: "p", ρ: "r",
  σ: "s", τ: "t", φ: "f", χ: "x", ψ: "ps", α: "a", ε: "e", η: "i", ι: "i", ο: "o", υ: "y", ω: "o"
};
const digraphs = { αι: "e", ει: "i", οι: "y", υι: "y", ου: "u" };
export const vowelPhones = new Set(["a", "e", "i", "o", "y", "u"]);

export function isProper(token) {
  return token.type === "proper" || token.pos === "proper_noun";
}

// Splits a word into base letters, remembering which ones carry a diaeresis (which blocks digraphs).
function baseLetters(word) {
  const result = [];
  for (const mark of word.normalize("NFD").toLowerCase().replace(/ς/g, "σ")) {
    if (/[α-ω]/.test(mark)) result.push({ letter: mark, split: false });
    else if (mark === "\u0308" && result.length) result.at(-1).split = true;
  }
  return result;
}

// Koine (Roman-era) pronunciation: αι→e, ει→i, οι/υ→y, ου→u, η→i, ω→o, aspirates as fricatives, no /h/.
export function koineIpa(word) {
  const chars = baseLetters(word);
  const phones = [];
  for (let index = 0; index < chars.length; index += 1) {
    const { letter, split } = chars[index];
    const next = chars[index + 1];
    const following = next?.letter;
    const pair = following && !next.split && !split ? letter + following : "";
    if (digraphs[pair]) {
      phones.push(digraphs[pair]);
      index += 1;
      continue;
    }
    if ((pair === "αυ" || pair === "ευ") && !split) {
      const after = chars[index + 2]?.letter;
      const stop = after === undefined || voiceless.has(after);
      phones.push(letter === "α" ? "a" : "e", stop ? "f" : "v");
      index += 1;
      continue;
    }
    if (letter === "γ") {
      if (chars[index - 1]?.letter === "γ") continue;
      if (following && velar.has(following)) phones.push("ŋ");
      else if (following && (frontVowels.has(following) || (digraphs[following + chars[index + 2]?.letter] === "e" || following + chars[index + 2]?.letter === "οι"))) phones.push("ʝ");
      else phones.push("ɣ");
      continue;
    }
    for (const phone of letters[letter] ?? []) phones.push(phone);
  }
  return phones;
}

export function diphonesOf(phones) {
  const pairs = [];
  for (let index = 0; index + 1 < phones.length; index += 1) pairs.push(`${phones[index]}-${phones[index + 1]}`);
  return pairs;
}

function syllableCount(phones) {
  return phones.filter((phone) => vowelPhones.has(phone)).length;
}

function ipaString(phones) {
  return `/${phones.join("")}/`;
}

// Max-heap on [gain desc, words asc, order asc]; entries are re-scored lazily as targets get covered.
export class Heap {
  constructor(before) {
    this.items = [];
    this.before = before;
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let child = items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.before(items[child], items[parent])) break;
      [items[child], items[parent]] = [items[parent], items[child]];
      child = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let best = parent;
        if (left < items.length && this.before(items[left], items[best])) best = left;
        if (right < items.length && this.before(items[right], items[best])) best = right;
        if (best === parent) break;
        [items[parent], items[best]] = [items[best], items[parent]];
        parent = best;
      }
    }
    return top;
  }
}

// Greedy set cover: repeatedly takes the candidate covering the most still-uncovered targets
// (ties: fewer words, then earlier in the text) until every coverable target is covered.
export function greedyCover(candidates, targetCount) {
  const covered = new Uint8Array(targetCount);
  const before = (a, b) => a.gain !== b.gain ? a.gain > b.gain
    : a.candidate.words !== b.candidate.words ? a.candidate.words < b.candidate.words
      : a.candidate.order < b.candidate.order;
  const heap = new Heap(before);
  for (const candidate of candidates) heap.push({ candidate, gain: candidate.targets.length });
  const picks = [];
  while (heap.size) {
    const entry = heap.pop();
    const fresh = entry.candidate.targets.filter((target) => !covered[target]);
    if (!fresh.length) continue;
    const current = { candidate: entry.candidate, gain: fresh.length };
    if (heap.size && before(heap.peek(), current)) {
      heap.push(current);
      continue;
    }
    for (const target of fresh) covered[target] = 1;
    picks.push({ candidate: entry.candidate, fresh });
  }
  return picks;
}

export function buildPromptSet(tokens) {
  const excluded = new Map();
  const segments = [];
  let segment = [];
  let verse;
  const flush = () => {
    if (segment.length) segments.push(segment);
    segment = [];
  };
  for (const token of tokens) {
    if (isProper(token)) {
      if (!excluded.has(token.surface)) {
        excluded.set(token.surface, { surface: token.surface, audio_action: "USE_ORIGINAL_PRONUNCIATION" });
      }
      flush();
      continue;
    }
    if (token.verse !== verse) {
      flush();
      verse = token.verse;
    }
    const phones = koineIpa(token.surface);
    if (phones.length) segment.push({ surface: token.surface, lemma: token.lemma, phones });
  }
  flush();

  // Top lemmas by frequency (ties by first appearance), counted over the retained words only.
  const lemmaCounts = new Map();
  for (const word of segments.flat()) lemmaCounts.set(word.lemma, (lemmaCounts.get(word.lemma) ?? 0) + 1);
  const topLemmas = new Set([...lemmaCounts].sort((a, b) => b[1] - a[1]).slice(0, topLemmaCount).map(([lemma]) => lemma));

  const targetIds = new Map();
  const targetNames = [];
  const targetId = (name) => {
    let id = targetIds.get(name);
    if (id === undefined) {
      id = targetNames.length;
      targetIds.set(name, id);
      targetNames.push(name);
    }
    return id;
  };

  const candidates = new Map();
  for (const words of segments) {
    for (let size = minWords; size <= maxWords; size += 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const group = words.slice(start, start + size);
        const phrase = group.map((word) => word.surface).join(" ");
        if (candidates.has(phrase)) continue;
        const phones = group.flatMap((word) => word.phones);
        const diphones = diphonesOf(phones);
        const lemmas = group.map((word) => word.lemma).filter((lemma) => topLemmas.has(lemma));
        candidates.set(phrase, {
          phrase, phones, diphones, words: size, order: candidates.size,
          targets: [...new Set([...diphones.map((name) => targetId(`d:${name}`)), ...lemmas.map((name) => targetId(`l:${name}`))])]
        });
      }
    }
  }

  const picks = greedyCover([...candidates.values()], targetNames.length);
  let seconds = 0;
  const queue = picks.map(({ candidate, fresh }, index) => {
    seconds += syllableCount(candidate.phones) * secondsPerSyllable + secondsPerPrompt;
    return {
      prompt_id: index + 1,
      phrase_greek: candidate.phrase,
      phonemes_ipa: ipaString(candidate.phones),
      new_diphones_covered: fresh.map((id) => targetNames[id]).filter((name) => name.startsWith("d:")).map((name) => name.slice(2)),
      audio_action: "RECORD_PROMPT"
    };
  });

  return {
    summary: {
      total_unique_diphones: targetNames.filter((name) => name.startsWith("d:")).length,
      prompts_generated: queue.length,
      estimated_recording_time_minutes: Math.round(seconds / 6) / 10
    },
    recording_queue: queue,
    proper_nouns_excluded: [...excluded.values()]
  };
}

// Translation cards: each card shows a Greek word or phrase and the speaker records its translation.
// Cards are picked greedily by newly covered text per second of recording, until `target` of all
// non-proper-noun tokens is covered. Phrases only qualify when they repeat, so they pay for themselves.
export const cardSecondsBase = 2;
export const cardSecondsPerWord = 0.7;
export const coverageTarget = 0.99;
const gospels = ["MAT", "MRK", "LUK", "JHN"];

const cardSeconds = (words) => cardSecondsBase + cardSecondsPerWord * words;
const cardKey = (surface) => surface.normalize("NFC").toLowerCase();

// unit "lemma" (default): one card per dictionary form covers all its inflections; "surface": one card per exact form.
export function buildCoveragePlan(tokens, { target = coverageTarget, unit = "lemma" } = {}) {
  const words = [];
  const segments = [];
  let segment = [];
  let verse;
  let proper = 0;
  const flush = () => {
    if (segment.length) segments.push(segment);
    segment = [];
  };
  for (const token of tokens) {
    if (isProper(token)) {
      proper += 1;
      flush();
      continue;
    }
    if (token.verse !== verse) {
      flush();
      verse = token.verse;
    }
    const shown = unit === "surface" ? token.surface : token.lemma;
    const word = { key: cardKey(shown), surface: shown, verse: token.verse, book: token.verse.split(" ")[0], id: words.length };
    words.push(word);
    segment.push(word);
  }
  flush();
  const appearance = [...new Set(words.map((word) => word.book))];

  const occurrences = new Map();
  for (const group of segments) {
    for (let size = 1; size <= maxWords; size += 1) {
      for (let start = 0; start + size <= group.length; start += 1) {
        const span = group.slice(start, start + size);
        const key = span.map((word) => word.key).join(" ");
        const entry = occurrences.get(key);
        if (entry) entry.spans.push(span);
        else occurrences.set(key, { key, size, spans: [span] });
      }
    }
  }
  const candidates = [...occurrences.values()].filter((entry) => entry.size === 1 || entry.spans.length > 1);

  // Covers `book` to the target given what is already `covered` (updated in place); returns the picked cards.
  const candidatesByBook = new Map(appearance.map((book) => [book, []]));
  for (const entry of candidates) for (const book of new Set(entry.spans.map((span) => span[0].book))) candidatesByBook.get(book).push(entry);
  const planBook = (book, covered) => {
    const goal = Math.ceil(words.filter((word) => word.book === book).length * target);
    const gainOf = (entry) => {
      const fresh = new Set();
      for (const span of entry.spans) for (const word of span) if (word.book === book && !covered[word.id]) fresh.add(word.id);
      return fresh;
    };
    let have = words.reduce((sum, word) => sum + (word.book === book && covered[word.id] ? 1 : 0), 0);
    const before = (a, b) => a.score !== b.score ? a.score > b.score : a.entry.size < b.entry.size;
    const heap = new Heap(before);
    for (const entry of candidatesByBook.get(book)) heap.push({ entry, score: gainOf(entry).size / cardSeconds(entry.size) });
    const picked = [];
    let time = 0;
    while (heap.size && have < goal) {
      const { entry } = heap.pop();
      const fresh = gainOf(entry);
      if (!fresh.size) continue;
      const current = { entry, score: fresh.size / cardSeconds(entry.size) };
      if (heap.size && before(heap.peek(), current)) {
        heap.push(current);
        continue;
      }
      have += fresh.size;
      // A recorded card also fills every other occurrence in the New Testament.
      for (const span of entry.spans) for (const word of span) covered[word.id] = 1;
      time += cardSeconds(entry.size);
      picked.push({ book, greek: entry.spans[0].map((word) => word.surface).join(" "), words: entry.size,
        occurrences: entry.spans.length, new_tokens: fresh.size, example_ref: entry.spans[0][0].verse, audio_action: "RECORD_TRANSLATION" });
    }
    return { picked, time };
  };

  // Recording order: the gospel that is quickest to record on its own, then always the remaining book that is
  // quickest to finish given the cards already recorded.
  const covered = new Uint8Array(words.length);
  const cards = [];
  const stages = [];
  const remaining = new Set(appearance);
  let seconds = 0;
  while (remaining.size) {
    const pool = !stages.length && gospels.some((book) => remaining.has(book)) ? gospels.filter((book) => remaining.has(book)) : [...remaining];
    let next;
    for (const book of pool) {
      const { time } = planBook(book, covered.slice());
      if (!next || time < next.time) next = { book, time };
    }
    const { book } = next;
    remaining.delete(book);
    const { picked, time } = planBook(book, covered);
    for (const card of picked) cards.push({ card_id: cards.length + 1, ...card });
    seconds += time;
    const own = words.filter((word) => word.book === book);
    const recordedTokens = covered.reduce((sum, flag) => sum + flag, 0);
    const round = (value) => Math.round(1000 * value) / 1000;
    stages.push({
      book, tokens: own.length, new_cards: picked.length, cumulative_cards: cards.length,
      book_coverage: round(own.filter((word) => covered[word.id]).length / own.length),
      cumulative_coverage: round(recordedTokens / words.length),
      book_minutes: Math.round(time / 6) / 10,
      cumulative_minutes: Math.round(seconds / 6) / 10
    });
  }

  const recorded = covered.reduce((sum, flag) => sum + flag, 0);
  return {
    summary: {
      tokens: words.length, proper_nouns_excluded: proper, unit, target_coverage: target,
      coverage: Math.round(1000 * recorded / words.length) / 1000, cards: cards.length,
      single_word_cards: cards.filter((card) => card.words === 1).length,
      estimated_recording_time_minutes: Math.round(seconds / 6) / 10,
      time_model: `${cardSecondsBase}s + ${cardSecondsPerWord}s per Greek word per card`
    },
    stages,
    cards
  };
}
