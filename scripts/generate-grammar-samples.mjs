// Writes site/static/grammar-samples.json: famous Mark verses (with MACULA role, case, mood and gloss) that the
// grammar-mapping page lets you rearrange. Needs the full TSV:
//   node scripts/generate-grammar-samples.mjs [path/to/macula-greek-SBLGNT.tsv]
import { writeFileSync } from "node:fs";
import { readTokens } from "./macula-tokens.mjs";

const verses = ["MRK 1:15", "MRK 1:17", "MRK 10:45", "MRK 12:30"];
const tokens = readTokens(process.argv[2] ?? "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv");
const samples = verses.map((verse) => ({
  verse,
  words: tokens.filter((token) => token.verse === verse).map(({ surface, lemma, pos, type, role, case: grammaticalCase, mood, gloss }) =>
    ({ surface, lemma, pos, type, role, case: grammaticalCase, mood, gloss }))
}));
for (const sample of samples) if (!sample.words.length) throw new Error(`${sample.verse} not found`);
writeFileSync(new URL("../site/static/grammar-samples.json", import.meta.url), `${JSON.stringify(samples, null, 1)}\n`);
console.log(`${samples.length} verses`);
