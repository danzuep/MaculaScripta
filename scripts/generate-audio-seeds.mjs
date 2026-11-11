// Writes site/static/audio-seeds.json: the sample verses recorded first in the audio workflow (the opening chapters of John, the first book to translate)
// with their MACULA role, case, mood and gloss. They are committed so sample builds work without the full dataset.
// The committed sample TSV only holds John 1; pass the full TSV to pick verses from John 2-3 as well.
//   node scripts/generate-audio-seeds.mjs [path/to/macula-greek-SBLGNT.tsv]
import { writeFileSync } from "node:fs";
import { readTokens } from "./macula-tokens.mjs";

const verses = ["JHN 1:1", "JHN 1:4", "JHN 1:12", "JHN 1:14", "JHN 1:29"];
const tokens = readTokens(process.argv[2] ?? "site/sample/macula-greek-SBLGNT.tsv");
const seeds = verses.map((verse) => ({ verse, words: tokens.filter((token) => token.verse === verse).map(({ verse: _, ...word }) => word) }));
for (const seed of seeds) if (!seed.words.length) throw new Error(`${seed.verse} not found`);
writeFileSync(new URL("../site/static/audio-seeds.json", import.meta.url), `${JSON.stringify(seeds)}\n`);
console.log(`${seeds.length} verses`);
