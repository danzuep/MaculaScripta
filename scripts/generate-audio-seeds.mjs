// Writes site/static/audio-seeds.json: the famous verses recorded first in the audio workflow (JHN 3:16, MRK 1:15, ...)
// with their MACULA role, case, mood and gloss. They are committed so sample builds work without the full dataset.
//   node scripts/generate-audio-seeds.mjs [path/to/macula-greek-SBLGNT.tsv]
import { writeFileSync } from "node:fs";
import { readTokens } from "./macula-tokens.mjs";

const verses = ["JHN 3:16", "MRK 1:15", "MRK 1:17", "MRK 10:45", "MRK 12:30"];
const tokens = readTokens(process.argv[2] ?? "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv");
const seeds = verses.map((verse) => ({ verse, words: tokens.filter((token) => token.verse === verse).map(({ verse: _, ...word }) => word) }));
for (const seed of seeds) if (!seed.words.length) throw new Error(`${seed.verse} not found`);
writeFileSync(new URL("../site/static/audio-seeds.json", import.meta.url), `${JSON.stringify(seeds)}\n`);
console.log(`${seeds.length} verses`);
