(() => {
  "use strict";

  // Word details, tooltips, annotations and the copy button are pure HTML/CSS; this persists the theme and copies the selected verse.
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

  const copy = document.querySelector(".reader-copy");
  copy?.addEventListener("click", async () => {
    const verse = document.getElementById(/^#(\d+)(?:!\d+)?$/.exec(location.hash)?.[1] ?? "");
    try {
      await navigator.clipboard.writeText(verse?.dataset.text || copy.dataset.text);
    } catch { return; }
    copy.classList.add("is-copied");
    setTimeout(() => copy.classList.remove("is-copied"), 1500);
  });

  // The close link scrolls to its word; then the fragment is dropped without another navigation.
  document.addEventListener("click", (event) => {
    if (event.target.closest(".reader-close")) setTimeout(() => history.replaceState(null, "", location.pathname + location.search));
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(document.body.dataset.workerUrl).catch(() => {
      // The reader remains usable when offline caching is unavailable.
    });
  }
})();
