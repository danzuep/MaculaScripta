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

  // Parses a published chapter TSV (the Macula header and rows, plus part_of_speech and definition columns).
  function parseTsv(text) {
    const [header, ...lines] = text.split("\n").filter(Boolean).map((line) => line.split("\t"));
    return { fields: header, words: lines };
  }

  // Turns parsed chapter rows (aligned with "fields") into words grouped by verse.
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

  // Builds one chapter's section and word-detail panes. Appended chapters get a heading and "<book>.<chapter>." id prefix.
  function renderChapter(chapter, { prefix = "", title = "" } = {}) {
    const model = chapterModel(chapter);
    const number = Number(model.verses[0]?.words[0].ref.split(" ")[1].split(":")[0]);
    const flow = element("p", { class: "reader-flow", lang: "grc" },
      element("sup", { class: "chapter-number" }, element("a", { href: "#", "aria-label": `Chapter ${number}`, text: number })));
    const defs = document.createDocumentFragment();
    for (const verse of model.verses) {
      flow.append(element("sup", { class: "verse-number" }, element("a", {
        id: prefix + verse.number, href: `#${prefix}${verse.number}`, "data-text": verse.plain,
        "aria-label": `Chapter ${number}, verse ${verse.number}`, text: verse.number
      })));
      for (const word of verse.words) {
        const key = `${prefix}${verse.number}!${word.position}`;
        const ruby = element("span", { class: "reader-token" }, element("ruby", { class: "reader-word" },
          element("a", { id: `w${key}`, href: `#${key}`, "aria-label": `${word.text}: ${word.gloss}`, text: word.text }),
          element("rt", { class: "rt-gloss", lang: "en", text: word.gloss }),
          element("rt", { class: "rt-mandarin", lang: "zh-Hans", text: word.mandarin })), word.after.trim());
        flow.append(ruby, " ");
        const list = element("dl");
        const { part_of_speech, definition, position, verse: verseNumber, ...source } = word;
        for (const [name, value] of Object.entries({ part_of_speech, definition, ...source })) {
          if (value) list.append(element("dt", { text: name }), element("dd", { text: value }));
        }
        defs.append(element("aside", { class: "reader-def", id: key, "aria-label": `Word details for ${word.text}` },
          element("header", { class: "reader-def-head" }, element("h2", { lang: "grc", text: word.text }),
            element("a", { class: "reader-close", href: "#_", "aria-label": "Close word details", text: "×" })),
          element("p", { class: "reader-def-ref", text: word.ref }), list));
      }
    }
    const section = element("section", { class: "reader-chapter", "aria-label": title || `Chapter ${number}` });
    if (title) section.append(element("h2", { class: "reader-chapter-title", text: title }));
    section.append(flow);
    return { section, defs, plain: model.plain };
  }

  // Next chapter after "code number" in the catalog ("MAT:28 MRK:16 ..."), continuing into the next book.
  function nextChapter(catalog, code, number) {
    const books = catalog.trim().split(/\s+/).map((entry) => entry.split(":"));
    const index = books.findIndex(([bookCode]) => bookCode === code);
    if (index < 0) return null;
    if (number < Number(books[index][1])) return { code, number: number + 1 };
    return books[index + 1] ? { code: books[index + 1][0], number: 1 } : null;
  }

  globalThis.MaculaReader = { chapterModel, parseTsv, nextChapter };

  const main = document.querySelector("main#reader[data-catalog]");
  const fetchChapter = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.statusText);
    return parseTsv(await response.text());
  };

  if (main?.dataset.chapterUrl) {
    fetchChapter(main.dataset.chapterUrl)
      .then((chapter) => {
        const { section, defs, plain } = renderChapter(chapter);
        main.replaceChildren(section);
        document.querySelector(".reader-defs")?.replaceChildren(defs);
        const copyButton = document.querySelector(".reader-copy");
        if (copyButton) copyButton.dataset.text = plain;
        // :target is not re-evaluated for elements added after load, so re-navigate to any word or verse in the URL.
        if (location.hash.length > 1) location.replace(location.pathname + location.search + location.hash);
      })
      .catch(() => {
        main.replaceChildren(element("p", { class: "reader-loading", role: "alert",
          text: `Unable to load ${main.dataset.book} ${main.dataset.chapter}. Check your connection and reload.` }));
      });
  }

  // Infinite scroll: the "next chapter" link doubles as the sentinel; as it nears the viewport the following
  // chapter (continuing into the next book) is appended, and the link is retargeted. Without JavaScript it stays a plain link.
  const sentinel = document.querySelector(".reader-next-chapter");
  if (main && sentinel && "IntersectionObserver" in globalThis) {
    const titles = Object.fromEntries([...document.querySelectorAll(".reader-books a")].map((link) => [link.getAttribute("href").split("/").filter(Boolean).pop(), link.textContent.trim()]));
    let upcoming = nextChapter(main.dataset.catalog, main.dataset.bookCode, Number(main.dataset.chapter));
    let loading = false;
    const label = (next) => `${titles[next.code] ?? next.code} ${next.number}`;
    const load = async () => {
      if (loading || !upcoming) return;
      loading = true;
      const next = upcoming;
      try {
        const chapter = await fetchChapter(`${main.dataset.dataUrl}${next.code}/${next.number}.tsv`);
        const { section, defs } = renderChapter(chapter, { prefix: `${next.code}.${next.number}.`, title: label(next) });
        main.append(section);
        document.querySelector(".reader-defs")?.append(defs);
        upcoming = nextChapter(main.dataset.catalog, next.code, next.number);
        if (upcoming) {
          sentinel.querySelector("a").textContent = `Next chapter: ${label(upcoming)} →`;
          sentinel.querySelector("a").href = `${main.dataset.dataUrl.replace(/nt-data\/$/, "")}nt/${upcoming.code}/${upcoming.number === 1 ? "" : `${upcoming.number}/`}`;
        } else {
          sentinel.remove();
        }
      } catch {
        upcoming = null; // leave the plain link in place so the reader can continue manually
      } finally {
        loading = false;
      }
    };
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      await load();
      if (upcoming && sentinel.isConnected) { observer.unobserve(sentinel); observer.observe(sentinel); }
    }, { rootMargin: "800px 0px" });
    observer.observe(sentinel);
  }

  const copy = document.querySelector(".reader-copy");
  copy?.addEventListener("click", async () => {
    const verse = document.getElementById(/^#([\w.]*\d)(?:!\d+)?$/.exec(location.hash)?.[1] ?? "");
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
