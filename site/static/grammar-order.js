// Grammar mapping: groups Greek words into chunks using MACULA metadata, learns from hand-ordered sample verses how
// the target language arranges them, and applies that order to any verse. Pure functions, usable in the browser and Node.
// Words are { surface, lemma, pos, role, case, mood, gloss } in Greek order.

const caseCodes = { nominative: "nom", accusative: "acc", dative: "dat", genitive: "gen", vocative: "voc" };
const nominal = new Set(["noun", "pron", "det", "adj", "num"]);
const heads = new Set(["noun", "pron", "num"]);

function nounSlot(word) {
  return `NP.${caseCodes[word.case] ?? "x"}`;
}

function verbSlot(word) {
  if (word.mood === "participle") return "PTC";
  if (word.mood === "infinitive") return "INF";
  return "V";
}

// Greek-order chunks: { slot, words }. Articles and adjectives join the noun that follows, a preposition takes its
// whole noun phrase, and a postposed adjective agreeing in case joins the noun before it. Genitives stay separate
// chunks so the target order can place them before or after their head.
export function chunkWords(words) {
  const chunks = [];
  let open = null;
  let last = null;
  const add = (slot, word, headed) => {
    const chunk = { slot, words: [word], headed };
    chunks.push(chunk);
    return chunk;
  };
  for (const word of words) {
    const pos = word.pos;
    if (pos === "verb") {
      open = last = null;
      add(verbSlot(word), word, true);
    } else if (pos === "prep") {
      last = null;
      open = add("PP", word, false);
    } else if (nominal.has(pos)) {
      if (open && !open.headed) {
        open.words.push(word);
        if (heads.has(pos)) {
          open.headed = true;
          if (open.slot !== "PP") open.slot = nounSlot(word);
          last = open;
        }
        continue;
      }
      if (pos === "adj" && last && last.headed && word.case === last.case) {
        last.words.push(word);
        continue;
      }
      open = add(nounSlot(word), word, heads.has(pos));
      open.case = word.case;
      last = open;
      if (open.headed) open = null;
    } else {
      open = last = null;
      add(pos === "conj" ? "CONJ" : pos === "adv" ? "ADV" : "OTHER", word, true);
    }
  }
  for (const chunk of chunks) {
    chunk.case ??= chunk.words.find((word) => heads.has(word.pos))?.case;
    delete chunk.headed;
  }
  return chunks;
}

// Each conjunction starts a new clause; chunks are only compared with others in the same clause.
export function clauseIds(chunks) {
  let clause = 0;
  return chunks.map((chunk, index) => {
    if (chunk.slot === "CONJ" && index > 0) clause += 1;
    return clause;
  });
}

const pairKey = (a, b) => `${a}|${b}`;

// `examples`: [{ chunks (Greek order), order } ] where order lists chunk indexes in the chosen target order.
export function learnRules(examples, previous = {}) {
  const rules = structuredClone(previous);
  for (const { chunks, order } of examples) {
    const clauses = clauseIds(chunks);
    const place = new Map(order.map((chunkIndex, position) => [chunkIndex, position]));
    for (let i = 0; i < chunks.length; i += 1) {
      for (let j = i + 1; j < chunks.length; j += 1) {
        if (clauses[i] !== clauses[j]) continue;
        const key = pairKey(chunks[i].slot, chunks[j].slot);
        const entry = rules[key] ??= { keep: 0, flip: 0 };
        entry[place.get(i) < place.get(j) ? "keep" : "flip"] += 1;
      }
    }
  }
  return rules;
}

// Copeland-style ordering inside each clause: a chunk ranks by how often the rules say it precedes the others.
// Slot pairs never seen in the samples keep their Greek order.
export function reorderChunks(chunks, rules) {
  const clauses = clauseIds(chunks);
  const keepsOrder = (i, j) => {
    const entry = rules[pairKey(chunks[i].slot, chunks[j].slot)];
    return entry ? entry.keep / (entry.keep + entry.flip) : 1;
  };
  const order = [];
  for (const clause of new Set(clauses)) {
    const members = chunks.map((_, index) => index).filter((index) => clauses[index] === clause);
    const score = new Map(members.map((i) => [i, members.reduce((sum, j) => {
      if (i === j) return sum;
      return sum + (i < j ? keepsOrder(i, j) : 1 - keepsOrder(j, i));
    }, 0)]));
    order.push(...members.sort((a, b) => score.get(b) - score.get(a) || a - b));
  }
  return order;
}

// Reorders every verse of a dataset ({ verse, ...word } tokens in reading order) into the target language's layout.
export function reorderDataset(tokens, rules) {
  const verses = [];
  let current;
  for (const token of tokens) {
    if (!current || current.verse !== token.verse) {
      current = { verse: token.verse, words: [] };
      verses.push(current);
    }
    current.words.push(token);
  }
  return verses.map(({ verse, words }) => {
    const chunks = chunkWords(words);
    const order = reorderChunks(chunks, rules);
    return {
      verse,
      greek: words.map((word) => word.surface).join(" "),
      target_order: order.flatMap((index) => chunks[index].words.map((word) => ({
        surface: word.surface, lemma: word.lemma, gloss: word.gloss, slot: chunks[index].slot
      })))
    };
  });
}
