// Reads a MACULA Greek TSV into { surface, lemma, pos, type, verse } tokens in reading order.
import { readFileSync } from "node:fs";

export function readTokens(path) {
  const file = path.startsWith("/") ? path : new URL(`../${path}`, import.meta.url);
  const [header, ...lines] = readFileSync(file, "utf8").trim().split("\n");
  const columns = header.split("\t");
  const at = Object.fromEntries(["ref", "class", "type", "text", "lemma"].map((name) => [name, columns.indexOf(name)]));
  return lines.map((line) => {
    const cells = line.split("\t");
    return { surface: cells[at.text], lemma: cells[at.lemma], pos: cells[at.class], type: cells[at.type], verse: cells[at.ref].split("!")[0] };
  });
}
