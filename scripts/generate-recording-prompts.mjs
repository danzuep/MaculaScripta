// Writes site/data/recording_prompts.json from a MACULA Greek TSV (default: the committed John 1 sample).
//   node scripts/generate-recording-prompts.mjs [path/to/macula-greek-SBLGNT.tsv] [output.json]
import { readFileSync, writeFileSync } from "node:fs";
import { buildPromptSet } from "../site/static/recording-prompts.js";

const root = (path) => new URL(`../${path}`, import.meta.url);
const source = process.argv[2] ?? "site/sample/macula-greek-SBLGNT.tsv";
const target = process.argv[3] ?? "site/data/recording_prompts.json";

const [header, ...lines] = readFileSync(source.startsWith("/") ? source : root(source), "utf8").trim().split("\n");
const columns = header.split("\t");
const at = Object.fromEntries(["ref", "class", "type", "text", "lemma"].map((name) => [name, columns.indexOf(name)]));
const tokens = lines.map((line) => {
  const cells = line.split("\t");
  return {
    surface: cells[at.text], lemma: cells[at.lemma], pos: cells[at.class], type: cells[at.type],
    verse: cells[at.ref].split("!")[0]
  };
});

const result = buildPromptSet(tokens);
writeFileSync(target.startsWith("/") ? target : root(target), `${JSON.stringify(result, null, 2)}\n`);
console.log(`${target}: ${result.summary.prompts_generated} prompts, ${result.summary.total_unique_diphones} diphones`);
