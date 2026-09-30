(() => {
  "use strict";
  document.documentElement.dataset.ready = "1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Theme ----------
  $(".theme-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
  });

  // ---------- Mobile nav ----------
  const toggle = $(".nav-toggle");
  const links = $("#nav-links");
  toggle?.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    links.classList.toggle("open", open);
  });
  $$("#nav-links a").forEach((a) => a.addEventListener("click", () => {
    toggle?.setAttribute("aria-expanded", "false");
    links.classList.remove("open");
  }));

  // ---------- Header border + active link ----------
  const header = $(".site-header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const navMap = new Map($$('.nav-links a[href^="#"]').map((a) => [a.getAttribute("href").slice(1), a]));
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navMap.forEach((a) => a.classList.remove("active"));
      navMap.get(entry.target.id)?.classList.add("active");
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navMap.forEach((_, id) => { const el = document.getElementById(id); if (el) sectionObserver.observe(el); });

  // ---------- Reveal on scroll ----------
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("visible"); revealObserver.unobserve(entry.target); }
    });
  }, { threshold: 0.12 });
  $$(".reveal").forEach((el) => (reduced ? el.classList.add("visible") : revealObserver.observe(el)));

  // ---------- Count-up metrics ----------
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      countObserver.unobserve(entry.target);
      const el = entry.target;
      const to = parseFloat(el.dataset.to);
      const decimals = parseInt(el.dataset.decimals || "0", 10);
      if (reduced) return;
      const start = performance.now();
      const duration = 1200;
      const frame = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (to * eased).toFixed(decimals);
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, { threshold: 0.6 });
  $$(".count").forEach((el) => countObserver.observe(el));

  // ---------- Terminal ----------
  const term = $("#terminal-body");
  if (term) {
    const lines = [
      ["prompt", "$ whoami"],
      ["out", "vivek-patil · backend · platform · ai-infra"],
      ["prompt", "$ cat impact.log"],
      ["kv", "services_scale", "millions of users / hour"],
      ["kv", "visually_ready_time", "-50%"],
      ["kv", "release_cycle", "4 weeks → 4 days"],
      ["kv", "sla_response_time", "-50%  (5 Office apps)"],
      ["kv", "llm_prompt_tokens", "-91.7%  (benchmark)"],
      ["kv", "unsafe_sql_blocked", "30 / 30"],
      ["prompt", "$ echo $NEXT_ROLE"],
      ["out", "Senior / Tech Lead · backend · platform · AI infra"],
    ];
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const toHtml = ([kind, a, b]) => {
      if (kind === "prompt") return `<span class="t-prompt">${esc(a)}</span>`;
      if (kind === "kv") return `<span class="t-key">${esc(a.padEnd(21))}</span><span class="t-good">${esc(b)}</span>`;
      return `<span class="t-dim">${esc(a)}</span>`;
    };
    const plain = ([kind, a, b]) => (kind === "kv" ? a.padEnd(21) + b : a);

    if (reduced) {
      term.innerHTML = lines.map(toHtml).join("\n");
    } else {
      let li = 0, ci = 0, done = "";
      const type = () => {
        if (li >= lines.length) { term.innerHTML = done + '<span class="cursor"></span>'; return; }
        const line = lines[li];
        const text = plain(line);
        if (line[0] !== "prompt") {
          done += toHtml(line) + "\n"; li += 1; term.innerHTML = done + '<span class="cursor"></span>';
          setTimeout(type, 140);
          return;
        }
        ci += 1;
        term.innerHTML = done + `<span class="t-prompt">${esc(text.slice(0, ci))}</span><span class="cursor"></span>`;
        if (ci >= text.length) { done += toHtml(line) + "\n"; li += 1; ci = 0; setTimeout(type, 380); }
        else setTimeout(type, 45);
      };
      setTimeout(type, 400);
    }
  }

  // ---------- Skill filter ----------
  const status = $("#skill-status");
  const skillButtons = $$(".skill");
  skillButtons.forEach((btn) => btn.setAttribute("aria-pressed", "false"));
  skillButtons.forEach((btn) => btn.addEventListener("click", () => {
    const active = btn.getAttribute("aria-pressed") === "true";
    skillButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
    const targets = $$("[data-skills]");
    targets.forEach((t) => t.classList.remove("hit"));
    if (active) { document.body.classList.remove("filtering"); status.textContent = ""; return; }

    btn.setAttribute("aria-pressed", "true");
    const skill = btn.dataset.skill;
    const hits = targets.filter((t) => t.dataset.skills.split(" ").includes(skill));
    hits.forEach((t) => t.classList.add("hit"));
    // Open collapsed sections that contain a match so it is visible.
    hits.forEach((t) => { const d = t.closest("details"); if (d) d.open = true; });
    document.body.classList.add("filtering");
    status.innerHTML = `${btn.textContent}: highlighted in ${hits.length} place${hits.length === 1 ? "" : "s"}. `
      + `<a href="#experience">See experience ↑</a> · <button type="button" class="link-btn" id="clear-skill">Clear</button>`;
    $("#clear-skill")?.addEventListener("click", () => btn.click());
  }));

  // ---------- Copy email ----------
  const toast = $("#toast");
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  };
  $("#copy-email")?.addEventListener("click", async (e) => {
    const email = e.currentTarget.dataset.email;
    try { await navigator.clipboard.writeText(email); showToast("Email copied"); }
    catch { showToast(email); }
  });

  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();
})();
