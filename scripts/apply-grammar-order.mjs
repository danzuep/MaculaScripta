// Applies grammar rules exported from the grammar-mapping page to a whole MACULA TSV and writes the target-order dataset.
//   node scripts/apply-grammar-order.mjs rules.json [path/to/macula-greek-SBLGNT.tsv] [output.json]
import { readFileSync, writeFileSync } from "node:fs";
import { reorderDataset } from "../site/static/grammar-order.js";
import { readTokens } from "./macula-tokens.mjs";

const [rulesPath, source = "data/macula-greek/SBLGNT/tsv/macula-greek-SBLGNT.tsv", target = "target-order.json"] = process.argv.slice(2);
if (!rulesPath) throw new Error("usage: node scripts/apply-grammar-order.mjs rules.json [tsv] [output.json]");
const { rules } = JSON.parse(readFileSync(rulesPath, "utf8"));
const verses = reorderDataset(readTokens(source), rules);
writeFileSync(target, `${JSON.stringify(verses)}\n`);
console.log(`${target}: ${verses.length} verses reordered`);
