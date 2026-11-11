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

function renderPlan(plan) {
  const { summary } = plan;
  const summaryList = document.querySelector("#plan-summary");
  for (const [label, value] of [["Cards", summary.cards], ["NT tokens covered", `${Math.round(summary.coverage * 1000) / 10}%`],
    ["Estimated recording time", `${Math.round(summary.estimated_recording_time_minutes / 6) / 10} h`]]) {
    const group = document.createElement("div");
    group.append(cell("dt", label), cell("dd", value));
    summaryList.append(group);
  }
  const percent = (value) => `${Math.round(value * 1000) / 10}%`;
  const body = document.querySelector("#plan-stages tbody");
  const select = document.querySelector("#plan-book");
  for (const stage of plan.stages) {
    const row = document.createElement("tr");
    row.append(cell("th", stage.book, { scope: "row" }), cell("td", stage.new_cards), cell("td", percent(stage.book_coverage)),
      cell("td", percent(stage.cumulative_coverage)), cell("td", `${stage.cumulative_minutes} min`));
    body.append(row);
    select.append(cell("option", `${stage.book} (${stage.new_cards})`, { value: stage.book }));
  }
  const list = document.querySelector("#plan-cards ol");
  const showBook = () => {
    list.replaceChildren(...plan.cards.filter((card) => card.book === select.value)
      .map((card) => cell("li", card.words > 1 ? card.greek : `${card.greek} · ×${card.occurrences}`)));
  };
  select.addEventListener("change", showBook);
  showBook();
  for (const selector of ["#plan-summary", "#plan-stages", "#plan-cards"]) document.querySelector(selector).hidden = false;
  document.querySelector("#plan-status").textContent = `${summary.cards} cards cover ${percent(summary.coverage)} of the New Testament.`;
}

try {
  const planResponse = await fetch(root.dataset.plan);
  if (!planResponse.ok) throw new Error(`HTTP ${planResponse.status}`);
  renderPlan(await planResponse.json());
} catch (error) {
  document.querySelector("#plan-status").textContent = `Could not load the plan: ${error.message}`;
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
