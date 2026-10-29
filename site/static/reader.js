(() => {
  "use strict";

  // Word details, tooltips, annotations and the copy button are pure HTML/CSS; this only persists the theme.
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(document.body.dataset.workerUrl).catch(() => {
      // The reader remains usable when offline caching is unavailable.
    });
  }
})();
