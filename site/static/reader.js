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
    const saved = settingValue("macula-scripta-theme");
    const systemLight = globalThis.matchMedia?.("(prefers-color-scheme: light)").matches;
    const applyTheme = () => { document.documentElement.dataset.theme = theme.checked ? "dark" : "light"; };
    theme.checked = saved === "light" || saved === "dark" ? saved === "dark" : !systemLight;
    applyTheme();
    theme.addEventListener("change", () => {
      applyTheme();
      saveSetting("macula-scripta-theme", theme.checked ? "dark" : "light");
    });
  }
  if (annotation) {
    const saved = settingValue("macula-scripta-annotation");
    if (saved === "mandarin" || saved === "none") annotation.value = saved;
    annotation.addEventListener("change", () => saveSetting("macula-scripta-annotation", annotation.value));
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

  // Next chapter after "code number" in the catalog ("MAT:28 MRK:16 ..."), continuing into the next book.
  function nextChapter(catalog, code, number) {
    const books = catalog.trim().split(/\s+/).map((entry) => entry.split(":"));
    const index = books.findIndex(([bookCode]) => bookCode === code);
    if (index < 0) return null;
    if (number < Number(books[index][1])) return { code, number: number + 1 };
    return books[index + 1] ? { code: books[index + 1][0], number: 1 } : null;
  }

  globalThis.MaculaReader = { nextChapter };

  const main = document.querySelector("main#reader[data-catalog]");
  const picker = document.querySelector(".reader-picker");
  const pickerButton = document.querySelector(".reader-picker-index");
  const settingsSwitch = document.querySelector(".reader-settings-switch");
  const readerTitle = document.querySelector("#reader-book-title");
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
    };
    const currentMode = () => (picker.hidden ? null : settingsView.hidden ? "books" : "settings");
    pickerButton.addEventListener("click", () => setMode(currentMode() === "books" ? null : "books"));
    settingsSwitch.addEventListener("click", () => setMode(currentMode() === "settings" ? null : "settings"));
    document.addEventListener("click", (event) => {
      if (!picker.hidden && !event.target.closest(".reader-picker, .reader-picker-bar")) setMode(null);
    });
    // Annotation changes reflow the text, so keep the first verse in view at the same offset and close the pane.
    let anchor = null;
    const rememberAnchor = () => {
      for (const link of main.querySelectorAll(".verse-number a")) {
        const rect = link.getBoundingClientRect();
        if (rect.bottom > 48) { anchor = { link, top: rect.top }; return; }
      }
      anchor = null;
    };
    annotation?.addEventListener("pointerdown", rememberAnchor);
    annotation?.addEventListener("focus", rememberAnchor);
    annotation?.addEventListener("change", () => {
      if (anchor) globalThis.scrollBy(0, anchor.link.getBoundingClientRect().top - anchor.top);
      anchor = null;
      setMode(null);
    });
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
      // Re-selecting the open chapter would reload the page and restore a scroll offset that included the panel, so jump in place instead.
      if (new URL(link.href).pathname === globalThis.location.pathname) {
        event.preventDefault();
        const target = main.querySelector(`.reader-chapter[data-book-code="${main.dataset.bookCode}"][data-chapter="${main.dataset.chapter}"]`);
        globalThis.scrollTo(0, target ? target.getBoundingClientRect().top + globalThis.scrollY - 72 : 0);
        return;
      }
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
    // Resuming only applies on the home page; an explicit book or chapter URL opens at that chapter's start.
    const onHome = globalThis.location?.pathname === main.dataset.readerBase.replace(/nt\/$/, "");
    if (savedPosition && onHome && !sameDestination && !hasHash
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
    schedulePositionSave();
  }, { passive: true });

  const restorePosition = () => {
    if (globalThis.location?.hash?.length > 1 || !savedPosition || globalThis.location?.pathname !== main?.dataset.readerBase.replace(/nt\/$/, "")
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

  // Each chapter is a static HTML fragment (one <section>, with its word-detail panes) published by Hugo.
  const fetchChapter = async (code, number) => {
    const response = await fetch(`${main.dataset.dataUrl}${code}/${number}.html`);
    if (!response.ok) throw new Error(response.statusText);
    const template = document.createElement("template");
    template.innerHTML = await response.text();
    return template.content.firstElementChild;
  };

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
        main.append(await fetchChapter(next.code, next.number));
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

  // Upward infinite scroll: a sentinel above the text prepends the previous chapter of the same book (none before chapter 1)
  // and compensates the scroll offset so the text being read does not jump.
  const topSentinel = document.querySelector(".reader-prev-sentinel");
  if (!redirectingToSavedPosition && main && topSentinel && "IntersectionObserver" in globalThis) {
    let loadingPrevious = false;
    const loadPrevious = async () => {
      const first = main.querySelector(".reader-chapter");
      const code = first?.dataset.bookCode;
      const number = Number(first?.dataset.chapter);
      if (loadingPrevious || !first || !code || !(number > 1)) return false;
      loadingPrevious = true;
      try {
        const previous = number - 1;
        const section = await fetchChapter(code, previous);
        const before = first.getBoundingClientRect().top;
        first.before(section);
        globalThis.scrollBy(0, first.getBoundingClientRect().top - before);
        updateStickyIndex();
        return previous > 1;
      } catch {
        return false;
      } finally {
        loadingPrevious = false;
      }
    };
    const topObserver = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (await loadPrevious()) { topObserver.unobserve(topSentinel); topObserver.observe(topSentinel); }
    }, { rootMargin: "800px 0px" });
    topObserver.observe(topSentinel);
  }

  const copy = document.querySelector(".reader-copy");
  copy?.addEventListener("click", async () => {
    const verse = document.getElementById(/^#([\w.]*\d)(?:!\d+)?$/.exec(location.hash)?.[1] ?? "");
    try {
      const chapter = main.querySelector(`.reader-chapter[data-book-code="${main.dataset.bookCode}"][data-chapter="${main.dataset.chapter}"]`);
      const plain = [...chapter.querySelectorAll(".verse-number a")].map((link) => link.dataset.text).join(" ");
      await navigator.clipboard.writeText(verse?.dataset.text || plain);
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

  if (!redirectingToSavedPosition && main) {
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
