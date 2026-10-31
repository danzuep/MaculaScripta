// Writes the committed sample TSVs used by quick Hugo builds (HUGO_PARAMS_SAMPLE=true): the full TSV header plus
// every row of John 1 (Greek) and Haggai 1 (Hebrew), copied unchanged from the pinned submodules.
//   node scripts/extract-sample-tsv.mjs
import { readFileSync, writeFileSync } from "node:fs";

const samples = [
  { source: "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv", target: "site/sample/macula-greek-SBLGNT.tsv", chapter: "JHN 1" },
  { source: "data/macula-hebrew/WLC/tsv/macula-hebrew.tsv", target: "site/sample/macula-hebrew.tsv", chapter: "HAG 1" }
];
const root = (path) => new URL(`../${path}`, import.meta.url);

for (const { source, target, chapter } of samples) {
  const lines = readFileSync(root(source), "utf8").replace(/\n$/, "").split("\n");
  if (lines[0].startsWith("version https://git-lfs")) throw new Error(`${source} is a Git LFS pointer; run git lfs pull first`);
  const rows = lines.slice(1).filter((line) => line.split("\t")[1].startsWith(`${chapter}:`));
  if (!rows.length) throw new Error(`${chapter} not found in ${source}`);
  writeFileSync(root(target), `${[lines[0], ...rows].join("\n")}\n`);
  console.log(`${target}: ${rows.length} rows of ${chapter}`);
}
