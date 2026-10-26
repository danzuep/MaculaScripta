(() => {
  const root = document.querySelector(".transformation");
  if (!root) return;

  const panels = [...root.querySelectorAll(".stage-panel")];
  const buttons = [...root.querySelectorAll(".nav-step")];
  const playButton = root.querySelector(".play-button");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const duration = Number(root.dataset.stepDuration);
  let currentStage = 0;
  let playing = !reducedMotion.matches;
  let elapsed = 0;
  let previousTime = null;
  let frame = null;

  function animateStage() {
    if (reducedMotion.matches || !playing) return;
    const panel = panels[currentStage];
    panel.querySelectorAll("[data-reorder]").forEach((row) => {
      const units = [...row.children];
      units.forEach((unit) => { unit.style.order = unit.dataset.sourceOrder; });
      const positions = units.map((unit) => unit.getBoundingClientRect());
      units.forEach((unit) => { unit.style.order = ""; });
      units.forEach((unit, index) => {
        const target = unit.getBoundingClientRect();
        unit.animate([
          { transform: `translate(${positions[index].left - target.left}px, ${positions[index].top - target.top}px)` },
          { transform: "translate(0, 0)" }
        ], { duration: 1000, delay: 120, fill: "backwards", easing: "ease-in-out" });
      });
    });
    panel.querySelectorAll(".inserted-word").forEach((unit) => {
      unit.animate([
        { opacity: 0, transform: "scale(0.5) translateY(-10px)" },
        { opacity: 1, transform: "scale(1) translateY(0)" }
      ], { duration: 800, easing: "ease-out" });
    });
  }

  function renderStage(index, announce = false) {
    panels[currentStage].getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    currentStage = index;
    elapsed = 0;
    previousTime = null;
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    buttons.forEach((button, i) => {
      if (i === index) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.style.setProperty("--progress", "0%");
    });
    if (announce) root.querySelector(".stage-status").textContent = panels[index].querySelector("h2").textContent;
    animateStage();
  }

  function tick(time) {
    if (!playing) return;
    if (previousTime !== null) elapsed += time - previousTime;
    previousTime = time;
    if (elapsed >= duration) renderStage((currentStage + 1) % panels.length);
    buttons[currentStage].style.setProperty("--progress", `${elapsed / duration * 100}%`);
    frame = requestAnimationFrame(tick);
  }

  function updatePlayback() {
    cancelAnimationFrame(frame);
    previousTime = null;
    playButton.textContent = playing ? "Pause Animation" : "Play Animation";
    panels[currentStage].getAnimations({ subtree: true }).forEach((animation) => {
      if (playing) animation.play();
      else animation.pause();
    });
    if (playing) frame = requestAnimationFrame(tick);
  }

  buttons.forEach((button, index) => button.addEventListener("click", () => renderStage(index, true)));
  playButton.addEventListener("click", () => {
    playing = !playing;
    updatePlayback();
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      playing = false;
      panels[currentStage].getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      updatePlayback();
    }
  });
  document.addEventListener("visibilitychange", () => { previousTime = null; });

  root.querySelector(".progress-nav").hidden = false;
  root.querySelector(".controls-bar").hidden = false;
  renderStage(0);
  updatePlayback();
})();
