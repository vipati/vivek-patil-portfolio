// Apply the saved or system theme before first paint to avoid a flash of the wrong theme.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  // Safety net: if main.js never runs, stop hiding the reveal-animated sections.
  window.addEventListener("load", () => {
    setTimeout(() => { if (!root.dataset.ready) root.classList.remove("js"); }, 1000);
  });
  try {
    const saved = localStorage.getItem("theme");
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    root.dataset.theme = saved || (prefersLight ? "light" : "dark");
  } catch (e) {
    /* storage unavailable: keep the default theme */
  }
})();
