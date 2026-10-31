// Regenerates the John 1:1-5 workbench data from the committed John 1 sample TSV (site/sample/macula-greek-SBLGNT.tsv):
//   site/data/greek_tokens.yaml         xml:id -> Greek text (with a trailing elision mark)
//   site/data/greek_token_details.yaml  xml:id -> lemma, Strong's id, part of speech
//   site/data/john_1_1.yaml             the Greek stage (words, grammar tag) of the John 1:1 transformation demo
// Everything the TSV does not carry (IPA, clause breaks, editorial grammar tags) is appended from
// scripts/john-1-1-extras.json; the English and Cantonese stages of john_1_1.yaml and the lemma definitions
// (greek_lemma_definitions.yaml) are hand-maintained and left untouched.
//   node scripts/generate-john-1-1-data.mjs          (refresh the sample first with scripts/extract-sample-tsv.mjs)
import { readFileSync, writeFileSync } from "node:fs";

const LAST_VERSE = 5;
const root = (path) => new URL(`../${path}`, import.meta.url);
const [header, ...lines] = readFileSync(root("site/sample/macula-greek-SBLGNT.tsv"), "utf8").replace(/\n$/, "").split("\n");
const columns = header.split("\t");
const rows = lines.map((line) => Object.fromEntries(line.split("\t").map((value, index) => [columns[index], value])));
const words = rows.filter((row) => {
  const [book, rest] = row.ref.split(" ");
  return book === "JHN" && Number(rest.split(":")[1].split("!")[0]) <= LAST_VERSE;
});
const extras = JSON.parse(readFileSync(root("scripts/john-1-1-extras.json"), "utf8"));

const partOfSpeech = (word) => {
  if (word.class === "pron" && word.type) return `${word.type[0].toUpperCase()}${word.type.slice(1)} pronoun`.replace("Personal pronoun", "Pronoun");
  return { prep: "Preposition", noun: "Noun", verb: "Verb", det: "Article", conj: "Conjunction", adv: "Adverb", adj: "Adjective",
    pron: "Pronoun", num: "Numeral", ptcl: "Particle", intj: "Interjection" }[word.class];
};
const grammar = (word) => extras.grammar[word["xml:id"]]
  ?? (word.role === "p" ? "PRED" : { prep: "PREP", noun: "NOUN", verb: "VERB", det: "ART", conj: "CONJ" }[word.class] ?? word.class.toUpperCase());

writeFileSync(root("site/data/greek_tokens.yaml"), words.map((word) => `${word["xml:id"]}: ${word.text}${word.after.trim() === "’" ? "’" : ""}\n`).join(""));
writeFileSync(root("site/data/greek_token_details.yaml"), words.map((word) => `${word["xml:id"]}:
  lemma: ${word.lemma}
  strong_id: strong:G${word.strong}
  part_of_speech: ${partOfSpeech(word)}
`).join(""));

const verseOne = words.filter((word) => word.ref.startsWith("JHN 1:1!"));
let offset = 0;
const clauses = extras.clauses.map((length) => {
  const units = verseOne.slice(offset, offset += length).map((word) => {
    const pronunciation = extras.pronunciation[word["xml:id"]];
    if (!pronunciation) throw new Error(`no IPA for ${word["xml:id"]} (${word.text}) in john-1-1-extras.json`);
    return `          - {text: ${word.text}, pronunciation: ${pronunciation}, grammar: ${grammar(word)}}\n`;
  });
  return `      - units:\n${units.join("")}`;
});
if (offset !== verseOne.length) throw new Error(`clauses cover ${offset} of ${verseOne.length} words in John 1:1`);

const path = root("site/data/john_1_1.yaml");
const yaml = readFileSync(path, "utf8");
const start = yaml.indexOf("  - id: greek\n");
const end = yaml.indexOf("  - id: english\n");
const greekStage = yaml.slice(start, end).split("    clauses:\n")[0];
writeFileSync(path, `${yaml.slice(0, start)}${greekStage}    clauses:\n${clauses.join("")}${yaml.slice(end)}`);

const definitions = new Set([...readFileSync(root("site/data/greek_lemma_definitions.yaml"), "utf8").matchAll(/^(.+?): /gm)].map((match) => match[1]));
const missing = [...new Set(words.map((word) => word.lemma))].filter((lemma) => !definitions.has(lemma));
if (missing.length) console.warn(`greek_lemma_definitions.yaml has no definition for: ${missing.join(", ")}`);
console.log(`${words.length} words in John 1:1-${LAST_VERSE}`);
