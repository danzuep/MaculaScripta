import { chunkWords, learnRules, reorderDataset } from "./grammar-order.js";

const root = document.querySelector("#grammar");
const status = document.querySelector("#grammar-status");
const language = document.querySelector("#grammar-language");
const storageKey = (name) => `macula-grammar-${name.trim() || "default"}`;
const previewVerses = 25;

function element(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  Object.assign(node, attributes);
  return node;
}

// One draggable list per sample verse; `order` holds chunk indexes in the current layout.
function buildSample(sample, onChange) {
  const chunks = chunkWords(sample.words);
  const state = { sample, chunks, order: chunks.map((_, index) => index), touched: false };
  const section = element("section", undefined, { className: "grammar-sample" });
  const list = element("ol", undefined, { className: "grammar-chunks" });
  section.append(element("h2", sample.verse), list);

  const draw = () => {
    list.replaceChildren(...state.order.map((chunkIndex, position) => {
      const chunk = chunks[chunkIndex];
      const item = element("li", undefined, { draggable: true, className: "grammar-chunk" });
      item.dataset.index = String(chunkIndex);
      item.append(element("span", chunk.words.map((word) => word.surface).join(" "), { lang: "grc" }),
        element("small", chunk.words.map((word) => word.gloss).filter(Boolean).join(" ")), element("small", chunk.slot, { className: "grammar-slot" }));
      for (const [label, delta] of [["←", -1], ["→", 1]]) {
        const button = element("button", label, { type: "button", ariaLabel: `Move ${label === "←" ? "earlier" : "later"}` });
        button.disabled = position + delta < 0 || position + delta >= state.order.length;
        button.addEventListener("click", () => move(position, position + delta));
        item.append(button);
      }
      item.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(position)));
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        move(Number(event.dataTransfer.getData("text/plain")), position);
      });
      return item;
    }));
  };
  const move = (from, to) => {
    const [moved] = state.order.splice(from, 1);
    state.order.splice(to, 0, moved);
    state.touched = true;
    draw();
    onChange();
  };
  const reset = element("button", "Reset to Greek order", { type: "button" });
  reset.addEventListener("click", () => {
    state.order = chunks.map((_, index) => index);
    state.touched = false;
    draw();
    onChange();
  });
  section.append(reset);
  draw();
  return { state, section };
}

function glossLine(verse) {
  return verse.target_order.map((word) => word.gloss || word.surface).join(" ");
}

try {
  const samples = await (await fetch(root.dataset.samples)).json();
  let rules = {};
  const container = document.querySelector("#grammar-samples");
  const rulesSection = document.querySelector("#grammar-rules-section");
  const built = samples.map((sample) => buildSample(sample, refresh));
  container.append(...built.map(({ section }) => section));

  function refresh() {
    const examples = built.filter(({ state }) => state.touched).map(({ state }) => ({ chunks: state.chunks, order: state.order }));
    rules = learnRules(examples);
    rulesSection.hidden = examples.length === 0;
    document.querySelector("#grammar-rules-summary").textContent =
      `${Object.keys(rules).length} slot-order rules learned from ${examples.length} of ${samples.length} verses.`;
    localStorage.setItem(storageKey(language.value), JSON.stringify(rules));
  }

  let reordered = [];
  document.querySelector("#grammar-apply").addEventListener("click", async () => {
    const response = await fetch(root.dataset.tokens);
    const rows = await response.json();
    reordered = reorderDataset(rows.map(([verse, surface, lemma, pos, type, role, gloss, grammaticalCase, mood]) =>
      ({ verse: verse.split("!")[0], surface, lemma, pos, type, role, gloss, case: grammaticalCase, mood })), rules);
    const body = document.querySelector("#grammar-preview tbody");
    body.replaceChildren(...reordered.slice(0, previewVerses).map((verse) => {
      const row = element("tr");
      row.append(element("td", verse.verse), element("td", verse.greek, { lang: "grc" }), element("td", glossLine(verse)));
      return row;
    }));
    document.querySelector("#grammar-preview").hidden = false;
    document.querySelector("#grammar-download").hidden = false;
    status.textContent = `Reordered ${reordered.length} verses into ${language.value} order.`;
  });

  const download = (name, data) => {
    const link = element("a", undefined, { download: name, href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })) });
    link.click();
    URL.revokeObjectURL(link.href);
  };
  document.querySelector("#grammar-export").addEventListener("click", () => download("grammar-rules.json", { language: language.value, rules }));
  document.querySelector("#grammar-download").addEventListener("click", () => download("target-order.json", reordered));
  status.textContent = "Drag the chunks (or use the arrow buttons) into the order your language uses, then apply the rules.";
} catch (error) {
  status.textContent = `Could not load the sample verses: ${error.message}`;
}
