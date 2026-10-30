(() => {
  "use strict";

  // Preloaded chapters are pure HTML/CSS; this persists the theme, copies the selected verse and loads other chapters on demand.
  const theme = document.querySelector("#reader-theme");
  if (theme) {
    let saved = null;
    try { saved = localStorage.getItem("macula-scripta-theme"); } catch { /* storage unavailable */ }
    theme.value = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme.value;
    theme.addEventListener("change", () => {
      document.documentElement.dataset.theme = theme.value;
      try { localStorage.setItem("macula-scripta-theme", theme.value); } catch { /* applies for this visit only */ }
    });
  }

  const separated = (word) => word.text + (/\s$/.test(word.after) ? word.after : word.after + " ");

  // Turns a published chapter file (rows aligned with "fields") into words grouped by verse.
  function chapterModel(chapter) {
    const words = chapter.words.map((row) => Object.fromEntries(chapter.fields.map((field, index) => [field, row[index] ?? ""])));
    const verses = [];
    for (const word of words) {
      const [, verse, position] = /^\S+ \d+:(\d+)!(\d+)$/.exec(word.ref) ?? [];
      if (!verse) continue;
      if (verses.at(-1)?.number !== verse) verses.push({ number: verse, words: [] });
      verses.at(-1).words.push({ ...word, position, verse });
    }
    for (const verse of verses) verse.plain = verse.words.map(separated).join("").trim();
    return { verses, plain: verses.map((verse) => verse.words.map(separated).join("")).join("").trim() };
  }

  const element = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (name === "text") node.textContent = value;
      else node.setAttribute(name, value);
    }
    node.append(...children);
    return node;
  };

  function renderChapter(chapter, main) {
    const model = chapterModel(chapter);
    const number = chapter.chapter;
    const flow = element("p", { class: "reader-flow", lang: "grc" },
      element("sup", { class: "chapter-number" }, element("a", { href: "#", "aria-label": `Chapter ${number}`, text: number })));
    const defs = document.createDocumentFragment();
    for (const verse of model.verses) {
      flow.append(element("sup", { class: "verse-number" }, element("a", {
        id: verse.number, href: `#${verse.number}`, "data-text": verse.plain,
        "aria-label": `Chapter ${number}, verse ${verse.number}`, text: verse.number
      })));
      for (const word of verse.words) {
        const key = `${verse.number}!${word.position}`;
        const ruby = element("ruby", { class: "reader-word" },
          element("a", { id: `w${key}`, href: `#${key}`, "aria-label": `${word.text}: ${word.gloss}`, text: word.text }),
          element("rt", { class: "rt-gloss", lang: "en", text: word.gloss }),
          element("rt", { class: "rt-mandarin", lang: "zh-Hans", text: word.mandarin }));
        flow.append(ruby, word.after + (/\s$/.test(word.after) ? "" : " "));
        const list = element("dl");
        const extra = [["part_of_speech", chapter.details?.[word["xml:id"]]], ["definition", chapter.definitions?.[word.lemma]]];
        for (const [name, value] of [...extra, ...Object.entries(word).filter(([name]) => !["position", "verse"].includes(name))]) {
          if (value) list.append(element("dt", { text: name }), element("dd", { text: value }));
        }
        defs.append(element("aside", { class: "reader-def", id: key, "aria-label": `Word details for ${word.text}` },
          element("header", { class: "reader-def-head" }, element("h2", { lang: "grc", text: word.text }),
            element("a", { class: "reader-close", href: "#_", "aria-label": "Close word details", text: "×" })),
          element("p", { class: "reader-def-ref", text: word.ref }), list));
      }
    }
    main.replaceChildren(element("section", { class: "reader-chapter", "aria-label": `Chapter ${number}` }, flow));
    document.querySelector(".reader-defs")?.replaceChildren(defs);
    const copyButton = document.querySelector(".reader-copy");
    if (copyButton) copyButton.dataset.text = model.plain;
    // :target is not re-evaluated for elements added after load, so re-navigate to any word or verse in the URL.
    const hash = location.hash;
    if (hash.length > 1) location.replace(location.pathname + location.search + hash);
  }

  globalThis.MaculaReader = { chapterModel };

  const chapterMain = document.querySelector("main[data-chapter-url]");
  if (chapterMain) {
    fetch(chapterMain.dataset.chapterUrl)
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText);
        return response.json();
      })
      .then((chapter) => renderChapter(chapter, chapterMain))
      .catch(() => {
        chapterMain.replaceChildren(element("p", { class: "reader-loading", role: "alert",
          text: `Unable to load ${chapterMain.dataset.book} ${chapterMain.dataset.chapter}. Check your connection and reload.` }));
      });
  }

  const copy = document.querySelector(".reader-copy");
  copy?.addEventListener("click", async () => {
    const verse = document.getElementById(/^#(\d+)(?:!\d+)?$/.exec(location.hash)?.[1] ?? "");
    try {
      await navigator.clipboard.writeText(verse?.dataset.text || copy.dataset.text);
    } catch { return; }
    copy.classList.add("is-copied");
    setTimeout(() => copy.classList.remove("is-copied"), 1500);
  });

  // The close link targets a missing id, so :target clears without scrolling; then the URL is tidied.
  document.addEventListener("click", (event) => {
    if (event.target.closest(".reader-close")) setTimeout(() => history.replaceState(null, "", location.pathname + location.search));
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(document.body.dataset.workerUrl).catch(() => {
      // The reader remains usable when offline caching is unavailable.
    });
  }
})();
