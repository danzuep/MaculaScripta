// Writes site/data/recording_prompts.json from a MACULA Greek TSV (default: the committed John 1 sample).
//   node scripts/generate-recording-prompts.mjs [path/to/macula-greek-SBLGNT.tsv] [output.json]
import { writeFileSync } from "node:fs";
import { readTokens } from "./macula-tokens.mjs";
import { buildPromptSet } from "../site/static/recording-prompts.js";

const root = (path) => new URL(`../${path}`, import.meta.url);
const source = process.argv[2] ?? "site/sample/macula-greek-SBLGNT.tsv";
const target = process.argv[3] ?? "site/data/recording_prompts.json";

const tokens = readTokens(source);

const result = buildPromptSet(tokens);
writeFileSync(target.startsWith("/") ? target : root(target), `${JSON.stringify(result, null, 2)}\n`);
console.log(`${target}: ${result.summary.prompts_generated} prompts, ${result.summary.total_unique_diphones} diphones`);
