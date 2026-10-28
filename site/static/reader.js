(() => {
  "use strict";

  const data = document.querySelector("#reader-data");
  if (!data) return;
  const book = JSON.parse(data.textContent);
  const words = book.chapters.flatMap((chapter) => chapter.verses.flatMap((verse) => verse.words));
  const buttons = Array.from(document.querySelectorAll(".reader-word"));
  const annotation = document.querySelector("#reader-annotation");
  const theme = document.querySelector("#reader-theme");
  const details = document.querySelector("#reader-details");
  const title = document.querySelector("#reader-details-title");
  const reference = document.querySelector("#reader-word-reference");
  const metadata = document.querySelector("#reader-metadata");
  let selected = null;

  function readSetting(key) {
    try {
      return localStorage.getItem(`macula-scripta-${key}`);
    } catch {
      return null;
    }
  }

  function saveSetting(key, value) {
    try {
      localStorage.setItem(`macula-scripta-${key}`, value);
    } catch {
      // Preferences still apply for this visit if browser storage is unavailable.
    }
  }

  function displayValue(value) {
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  const fields = [...new Set(words.flatMap((word) => Object.keys(word)))].sort();
  for (const field of fields) {
    if (field === "gloss" || field === "mandarin") continue;
    const option = document.createElement("option");
    option.value = `field:${field}`;
    option.textContent = field;
    annotation.append(option);
  }

  function renderAnnotations() {
    const setting = annotation.value;
    document.documentElement.dataset.readerAnnotation = setting === "__none" ? "none" : "visible";
    buttons.forEach((button) => {
      const word = words[Number(button.dataset.wordIndex)];
      const rubyText = button.querySelector("rt");
      const value = setting === "__gloss" ? word.gloss
        : setting === "__mandarin" ? word.mandarin
          : setting === "__none" ? "" : word[setting.slice("field:".length)];
      rubyText.textContent = displayValue(value);
      if (setting === "__gloss" || setting === "__mandarin") {
        rubyText.lang = setting === "__gloss" ? "en" : "zh-Hans";
      } else {
        rubyText.removeAttribute("lang");
      }
    });
  }

  const previousAnnotation = readSetting("reader-annotation");
  const savedAnnotation = {
    "__english": "__gloss",
    "field:gloss": "__gloss",
    "field:mandarin": "__mandarin"
  }[previousAnnotation] || previousAnnotation;
  if ([...annotation.options].some((option) => option.value === savedAnnotation)) {
    annotation.value = savedAnnotation;
  }
  renderAnnotations();
  annotation.addEventListener("change", () => {
    renderAnnotations();
    saveSetting("reader-annotation", annotation.value);
  });

  const savedTheme = readSetting("theme");
  theme.value = savedTheme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme.value;
  theme.addEventListener("change", () => {
    document.documentElement.dataset.theme = theme.value;
    saveSetting("theme", theme.value);
  });

  function closeDetails() {
    if (!selected) return;
    const previous = selected;
    previous.setAttribute("aria-expanded", "false");
    selected = null;
    details.hidden = true;
    previous.focus();
  }

  document.querySelector("#reader").addEventListener("click", (event) => {
    const button = event.target.closest(".reader-word");
    if (!button) return;
    if (selected === button) {
      closeDetails();
      return;
    }
    if (selected) selected.setAttribute("aria-expanded", "false");
    selected = button;
    selected.setAttribute("aria-expanded", "true");
    const word = words[Number(button.dataset.wordIndex)];
    title.textContent = word.text;
    reference.textContent = displayValue(word.ref || word["xml:id"]);
    metadata.replaceChildren();
    for (const [field, value] of Object.entries(word)) {
      const term = document.createElement("dt");
      term.textContent = field;
      const definition = document.createElement("dd");
      const text = displayValue(value);
      definition.textContent = text === "" ? "(empty)" : text;
      metadata.append(term, definition);
    }
    details.hidden = false;
    title.focus({ preventScroll: true });
  });

  document.querySelector("#reader-close-details").addEventListener("click", closeDetails);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      closeDetails();
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(document.body.dataset.workerUrl).catch(() => {
      // The reader remains usable when offline caching is unavailable.
    });
  }
})();
