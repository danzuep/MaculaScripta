(() => {
  "use strict";

  // Preloaded chapters are server-rendered; browser storage keeps reader preferences and the last visible verse.
  const theme = document.querySelector("#reader-theme");
  const annotation = document.querySelector("#reader-annotation");
  const offlineToggle = document.querySelector("#reader-offline");
  const settingValue = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const saveSetting = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* applies for this visit only */ }
  };

  if (theme) {
    theme.value = settingValue("macula-scripta-theme") === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme.value;
    theme.addEventListener("change", () => {
      document.documentElement.dataset.theme = theme.value;
      saveSetting("macula-scripta-theme", theme.value);
    });
  }
  if (annotation) {
    const saved = settingValue("macula-scripta-annotation");
    if (saved === "mandarin") annotation.value = saved;
    annotation.addEventListener("change", () => saveSetting("macula-scripta-annotation", annotation.value));
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
  function renderChapter(chapter, { prefix = "", title = "", code = "", chapterNumber = "" } = {}) {
    const model = chapterModel(chapter);
    const number = Number(model.verses[0]?.words[0].ref.split(" ")[1].split(":")[0]);
    const flow = element("p", { class: "reader-flow", lang: "grc" },
      element("sup", { class: "chapter-number" }, element("a", { href: "#", "aria-label": `Chapter ${number}`, text: number })));
    const defs = document.createDocumentFragment();
    for (const verse of model.verses) {
      flow.append(element("sup", { class: "verse-number" }, element("a", {
        id: prefix + verse.number, href: `#${prefix}${verse.number}`, "data-text": verse.plain,
        "data-ref": code ? `${code}/${chapterNumber}:${verse.number}` : "",
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
    if (code) {
      section.dataset.bookCode = code;
      section.dataset.chapter = chapterNumber;
    }
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
  const picker = document.querySelector(".reader-picker");
  const pickerButton = document.querySelector(".reader-picker-index");
  const settingsSwitch = document.querySelector(".reader-settings-switch");
  const readerTitle = document.querySelector("#reader-book-title");
  const pickerBar = document.querySelector(".reader-picker-bar");
  const pickerBarTop = pickerBar ? pickerBar.getBoundingClientRect().top + globalThis.scrollY : 0;
  const bookTitles = new Map([...document.querySelectorAll(".reader-book-tile")].map((tile) => [tile.dataset.bookCode, tile.dataset.bookTitle]));
  if (picker && main) {
    const bookView = picker.querySelector(".reader-book-picker-view");
    const settingsView = picker.querySelector(".reader-settings-view");
    const bookGrid = picker.querySelector(".reader-book-grid");
    const chapterPicker = picker.querySelector(".reader-chapter-picker");
    const chapterGrid = picker.querySelector(".reader-chapter-grid");
    const instruction = picker.querySelector(".reader-picker-instruction");
    const fullNameToggle = picker.querySelector("#reader-full-book-names");
    const applyBookNamePreference = () => {
      for (const tile of bookGrid.querySelectorAll(".reader-book-tile")) {
        tile.dataset.fullName = String(fullNameToggle.checked);
        tile.textContent = fullNameToggle.checked ? tile.dataset.bookTitle : tile.dataset.bookCode;
      }
    };
    fullNameToggle.checked = settingValue("macula-scripta-full-book-names") === "true";
    applyBookNamePreference();
    fullNameToggle.addEventListener("change", () => {
      saveSetting("macula-scripta-full-book-names", String(fullNameToggle.checked));
      applyBookNamePreference();
    });
    const showBooks = () => {
      bookGrid.hidden = false;
      chapterPicker.hidden = true;
      instruction.textContent = "1. Choose a book";
    };
    // mode is "books", "settings" or null (reading); tapping the active control collapses back to reading.
    const setMode = (mode) => {
      picker.hidden = !mode;
      bookView.hidden = mode !== "books";
      settingsView.hidden = mode !== "settings";
      if (mode === "books") showBooks();
      pickerButton.setAttribute("aria-expanded", String(mode === "books"));
      settingsSwitch.setAttribute("aria-expanded", String(mode === "settings"));
      updatePickerPosition();
    };
    const currentMode = () => (picker.hidden ? null : settingsView.hidden ? "books" : "settings");
    pickerButton.addEventListener("click", () => setMode(currentMode() === "books" ? null : "books"));
    settingsSwitch.addEventListener("click", () => setMode(currentMode() === "settings" ? null : "settings"));
    bookGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-book-code]");
      if (!button) return;
      const { bookCode, bookTitle, chapters } = button.dataset;
      bookGrid.hidden = true;
      chapterPicker.hidden = false;
      instruction.textContent = `2. Choose a chapter in ${bookTitle}`;
      chapterGrid.replaceChildren(...Array.from({ length: Number(chapters) }, (_, index) => {
        const number = index + 1;
        const path = `${main.dataset.readerBase}${bookCode}/${number === 1 ? "" : `${number}/`}`;
        const link = element("a", {
          class: "reader-grid-tile",
          href: path,
          "aria-label": `${bookTitle} ${number}`,
          "aria-current": bookCode === main.dataset.bookCode && number === Number(main.dataset.chapter) ? "true" : "false",
          text: number
        });
        return link;
      }));
    });
    picker.querySelector(".reader-picker-back").addEventListener("click", showBooks);
    chapterGrid.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      setMode(null);
      try { sessionStorage.setItem("macula-scripta-reader-navigation", new URL(link.href).pathname); } catch { /* resume remains available next visit */ }
    });
  }

  const updateStickyIndex = () => {
    if (!main) return;
    const sections = main.querySelectorAll(".reader-chapter");
    let activeSection = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 96) activeSection = section;
      else break;
    }
    const code = activeSection?.dataset.bookCode || main.dataset.bookCode;
    const chapter = activeSection?.dataset.chapter || main.dataset.chapter;
    const title = bookTitles.get(code) ?? main.dataset.bookTitle ?? code;
    if (readerTitle) readerTitle.textContent = `${title} ${chapter}`;
    if (pickerButton) pickerButton.textContent = `${title} ${chapter}`;
  };

  const updatePickerPosition = () => {
    if (!pickerBar) return;
    const floating = globalThis.scrollY >= pickerBarTop - 8;
    pickerBar.classList.toggle("is-floating", floating);
    picker?.classList.toggle("is-floating", floating && !picker.hidden);
  };
  updatePickerPosition();

  let redirectingToSavedPosition = false;
  let savedPosition = null;
  if (main) {
    try {
      const rawPosition = localStorage.getItem("macula-scripta-last-verse");
      savedPosition = rawPosition ? JSON.parse(rawPosition) : null;
    } catch { /* storage unavailable or invalid */ }
    let navigationIntent = null;
    try {
      navigationIntent = sessionStorage.getItem("macula-scripta-reader-navigation");
      sessionStorage.removeItem("macula-scripta-reader-navigation");
    } catch { /* session storage unavailable */ }
    const sameDestination = navigationIntent === globalThis.location?.pathname;
    const hasHash = globalThis.location?.hash?.length > 1;
    if (savedPosition && !sameDestination && !hasHash
      && (savedPosition.book !== main.dataset.bookCode || Number(savedPosition.chapter) !== Number(main.dataset.chapter))
      && /^[A-Z0-9]{3}$/.test(savedPosition.book)
      && Number.isInteger(Number(savedPosition.chapter)) && Number(savedPosition.chapter) > 0) {
      const chapter = Number(savedPosition.chapter);
      const path = `${main.dataset.readerBase}${savedPosition.book}/${chapter === 1 ? "" : `${chapter}/`}`;
      globalThis.location.replace(path);
      redirectingToSavedPosition = true;
    }
  }

  let lastSavedReference = "";
  let savePositionScheduled = false;
  const saveVisibleVerse = () => {
    savePositionScheduled = false;
    if (!main) return;
    const visibleVerses = main.querySelectorAll(".verse-number a[data-ref]");
    let lastVisible = null;
    for (const verse of visibleVerses) {
      const rect = verse.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= globalThis.innerHeight) lastVisible = verse;
    }
    const match = /^([A-Z0-9]{3})\/(\d+):(\d+)$/.exec(lastVisible?.dataset.ref ?? "");
    if (!match || lastVisible.dataset.ref === lastSavedReference) return;
    lastSavedReference = lastVisible.dataset.ref;
    try {
      localStorage.setItem("macula-scripta-last-verse", JSON.stringify({
        book: match[1], chapter: Number(match[2]), verse: Number(match[3]), ref: lastVisible.dataset.ref
      }));
    } catch { /* reading continues without position persistence */ }
  };
  const schedulePositionSave = () => {
    if (savePositionScheduled) return;
    savePositionScheduled = true;
    if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(saveVisibleVerse);
    else saveVisibleVerse();
  };
  globalThis.addEventListener?.("scroll", () => {
    updateStickyIndex();
    updatePickerPosition();
    schedulePositionSave();
  }, { passive: true });

  const restorePosition = () => {
    if (globalThis.location?.hash?.length > 1 || !savedPosition
      || savedPosition.book !== main?.dataset.bookCode
      || Number(savedPosition.chapter) !== Number(main?.dataset.chapter)) return;
    const ref = `${savedPosition.book}/${Number(savedPosition.chapter)}:${Number(savedPosition.verse)}`;
    let verse = null;
    for (const candidate of main.querySelectorAll(".verse-number a[data-ref]")) {
      if (candidate.dataset.ref === ref) {
        verse = candidate;
        break;
      }
    }
    verse?.scrollIntoView({ block: "start" });
    schedulePositionSave();
  };

  const fetchChapter = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.statusText);
    return parseTsv(await response.text());
  };

  if (!redirectingToSavedPosition && main?.dataset.chapterUrl) {
    fetchChapter(main.dataset.chapterUrl)
      .then((chapter) => {
        const { section, defs, plain } = renderChapter(chapter, {
          code: main.dataset.bookCode, chapterNumber: main.dataset.chapter
        });
        main.replaceChildren(section);
        document.querySelector(".reader-defs")?.replaceChildren(defs);
        const copyButton = document.querySelector(".reader-copy");
        if (copyButton) copyButton.dataset.text = plain;
        restorePosition();
        schedulePositionSave();
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
  if (!redirectingToSavedPosition && main && sentinel && "IntersectionObserver" in globalThis) {
    const titles = Object.fromEntries(bookTitles);
    let upcoming = nextChapter(main.dataset.catalog, main.dataset.bookCode, Number(main.dataset.chapter));
    let loading = false;
    const label = (next) => `${titles[next.code] ?? next.code} ${next.number}`;
    const load = async () => {
      if (loading || !upcoming) return;
      loading = true;
      const next = upcoming;
      try {
        const chapter = await fetchChapter(`${main.dataset.dataUrl}${next.code}/${next.number}.tsv`);
        const { section, defs } = renderChapter(chapter, {
          prefix: `${next.code}.${next.number}.`, title: label(next), code: next.code, chapterNumber: next.number
        });
        main.append(section);
        document.querySelector(".reader-defs")?.append(defs);
        updateStickyIndex();
        schedulePositionSave();
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
    copy.firstElementChild.textContent = "✓";
    setTimeout(() => {
      copy.classList.remove("is-copied");
      copy.firstElementChild.textContent = "⧉";
    }, 1500);
  });

  // The close link targets a missing id, so :target clears without scrolling; then the URL is tidied.
  document.addEventListener("click", (event) => {
    if (event.target.closest(".reader-close")) setTimeout(() => history.replaceState(null, "", location.pathname + location.search));
    const nextLink = event.target.closest(".reader-next-chapter a");
    if (nextLink) try { sessionStorage.setItem("macula-scripta-reader-navigation", new URL(nextLink.href).pathname); } catch { /* resume remains available next visit */ }
  });

  if (!redirectingToSavedPosition && main && !main.dataset.chapterUrl) {
    restorePosition();
    schedulePositionSave();
  }

  if (offlineToggle) {
    offlineToggle.checked = settingValue("macula-scripta-offline") === "true";
    offlineToggle.addEventListener("change", () => {
      saveSetting("macula-scripta-offline", String(offlineToggle.checked));
      globalThis.navigator?.serviceWorker?.ready.then((registration) => {
        registration.active?.postMessage({ type: "SET_OFFLINE_MODE", enabled: offlineToggle.checked });
      });
    });
  }

  if ("serviceWorker" in navigator) {
    const updateOfflineMode = (worker) => {
      worker?.postMessage({ type: "SET_OFFLINE_MODE", enabled: offlineToggle?.checked ?? false });
    };
    navigator.serviceWorker.register(document.body.dataset.workerUrl).then(() => {
      navigator.serviceWorker.ready?.then((registration) => updateOfflineMode(registration.active));
    }).catch(() => {
      // The reader remains usable when offline caching is unavailable.
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => updateOfflineMode(navigator.serviceWorker.controller));
  }
})();
