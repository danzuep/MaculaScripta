// Writes site/static/recording-plan.json: one translation card per lemma, in recording order, covering 100% of the New Testament.
// Run it on the full TSV (git submodule data/macula-greek, then git lfs pull if needed), not the John 1 sample:
//   node scripts/generate-recording-plan.mjs [path/to/macula-greek-SBLGNT.tsv] [lemma|surface] [output.json]
import { writeFileSync } from "node:fs";
import { buildCoveragePlan } from "../site/static/recording-prompts.js";
import { readTokens } from "./macula-tokens.mjs";

const source = process.argv[2] ?? "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv";
const unit = process.argv[3] ?? "lemma";
const target = process.argv[4] ?? "site/static/recording-plan.json";

const full = buildCoveragePlan(readTokens(source), { unit, maxPhrase: 1 });
const plan = { ...full, cards: full.cards.map(({ book, greek, gloss, occurrences }) => ({ book, greek, gloss, occurrences })) };
writeFileSync(target.startsWith("/") ? target : new URL(`../${target}`, import.meta.url), `${JSON.stringify(plan)}\n`);
const { summary } = plan;
console.log(`${target}: ${summary.cards} cards, ${summary.coverage * 100}% of ${summary.tokens} tokens, ${summary.estimated_recording_time_minutes} min`);
