// Writes site/static/recording-plan.json: the translation cards needed to cover 99% of the New Testament.
// Run it on the full TSV (git submodule data/macula-greek, then git lfs pull if needed), not the John 1 sample:
//   node scripts/generate-recording-plan.mjs [path/to/macula-greek-SBLGNT.tsv] [lemma|surface] [output.json]
import { writeFileSync } from "node:fs";
import { buildCoveragePlan } from "../site/static/recording-prompts.js";
import { readTokens } from "./macula-tokens.mjs";

const source = process.argv[2] ?? "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv";
const unit = process.argv[3] ?? "lemma";
const target = process.argv[4] ?? "site/static/recording-plan.json";

const plan = buildCoveragePlan(readTokens(source), { unit });
writeFileSync(target.startsWith("/") ? target : new URL(`../${target}`, import.meta.url), `${JSON.stringify(plan)}\n`);
const { summary } = plan;
console.log(`${target}: ${summary.cards} cards, ${summary.coverage * 100}% of ${summary.tokens} tokens, ${summary.estimated_recording_time_minutes} min`);
