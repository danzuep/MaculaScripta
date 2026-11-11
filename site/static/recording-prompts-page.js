import { buildPromptSet } from "./recording-prompts.js";

const root = document.querySelector("#prompts");
const status = document.querySelector("#prompts-status");

function cell(tag, text, attributes = {}) {
  const element = document.createElement(tag);
  element.textContent = text;
  Object.assign(element, attributes);
  return element;
}

function render(result) {
  const { summary } = result;
  const summaryList = document.querySelector("#prompts-summary");
  for (const [label, value] of [["Unique diphones", summary.total_unique_diphones], ["Prompts", summary.prompts_generated],
    ["Estimated recording time", `${summary.estimated_recording_time_minutes} min`]]) {
    const group = document.createElement("div");
    group.append(cell("dt", label), cell("dd", value));
    summaryList.append(group);
  }
  const body = document.querySelector("#prompts-queue tbody");
  for (const prompt of result.recording_queue) {
    const row = document.createElement("tr");
    row.append(cell("td", prompt.prompt_id), cell("td", prompt.phrase_greek, { lang: "grc" }),
      cell("td", prompt.phonemes_ipa), cell("td", prompt.new_diphones_covered.join(" ")));
    body.append(row);
  }
  document.querySelector("#prompts-excluded p").textContent = result.proper_nouns_excluded.map((noun) => noun.surface).join(" · ");
  const download = document.querySelector("#prompts-download");
  download.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "recording_prompts.json";
    link.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    link.click();
    URL.revokeObjectURL(link.href);
  });
  for (const selector of ["#prompts-summary", "#prompts-queue", "#prompts-excluded", "#prompts-download"]) {
    document.querySelector(selector).hidden = false;
  }
  status.textContent = `${summary.prompts_generated} prompts cover ${summary.total_unique_diphones} diphones.`;
}

try {
  const response = await fetch(root.dataset.tokens);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const rows = await response.json();
  // Let the status paint before the synchronous set cover runs.
  await new Promise((resolve) => setTimeout(resolve));
  render(buildPromptSet(rows.map(([verse, surface, lemma, pos, type]) => ({ verse: verse.split("!")[0], surface, lemma, pos, type }))));
} catch (error) {
  status.textContent = `Could not build the prompt set: ${error.message}`;
}
