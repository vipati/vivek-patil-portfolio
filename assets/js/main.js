(() => {
  "use strict";

  /* Set this to your Formspree (or similar) endpoint, e.g. "https://formspree.io/f/abcdwxyz",
     to deliver messages. Left empty, the form validates and hands the visitor a ready-to-send draft. */
  const FORM_ENDPOINT = "";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Toast + copy ---------- */
  const toast = $("#toast");
  let toastTimer;
  const showToast = (msg) => { toast.textContent = msg; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1900); };
  const copy = async (text, okMsg, fallbackEl) => {
    try { await navigator.clipboard.writeText(text); showToast(okMsg); }
    catch {
      if (fallbackEl) { const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      showToast("Selected. Press Ctrl+C to copy");
    }
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b) copy(b.dataset.copy, "Email copied", $("#email-addr"));
  });

  /* ---------- Nav ---------- */
  const menuBtn = $("#menu-btn"), links = $("#nav-links");
  menuBtn.addEventListener("click", () => {
    const open = menuBtn.getAttribute("aria-expanded") !== "true";
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.textContent = open ? "Close" : "Menu";
    links.classList.toggle("open", open);
  });
  $$("#nav-links a").forEach((a) => a.addEventListener("click", () => { menuBtn.setAttribute("aria-expanded", "false"); menuBtn.textContent = "Menu"; links.classList.remove("open"); }));
  const navMap = new Map($$('#nav-links a[href^="#"]').map((a) => [a.getAttribute("href").slice(1), a]));
  const so = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    navMap.forEach((a) => a.removeAttribute("aria-current"));
    navMap.get(en.target.id)?.setAttribute("aria-current", "true");
  }), { rootMargin: "-40% 0px -55% 0px" });
  navMap.forEach((_, id) => { const el = document.getElementById(id); if (el) so.observe(el); });

  /* ---------- Count-up (numbers are already correct at rest) ---------- */
  if (!reduced) {
    const co = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      co.unobserve(en.target);
      const el = en.target, to = parseFloat(el.dataset.to), dec = +(el.dataset.dec || 0), t0 = performance.now();
      const f = (now) => { const p = Math.min((now - t0) / 1100, 1); el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec); if (p < 1) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    }), { threshold: 0.8 });
    $$(".count").forEach((el) => co.observe(el));
  }

  /* =========================================================
     Gateway demo (port of llm-token-optimization-gateway)
     ========================================================= */
  const Gateway = (() => {
    const CONTEXT = `You are a helpful support assistant for Acme Cloud, an internal SaaS product.
Company boilerplate: Always be polite. Always be clear. Always be concise.
Company boilerplate: Always be polite. Always be clear. Always be concise.
Company boilerplate: Always be polite. Always be clear. Always be concise.

Password reset policy:
Users can reset a password from the account login page by clicking Forgot Password.
The reset link expires after 30 minutes.
Administrators cannot view user passwords.
After five failed sign-in attempts the account is locked for 15 minutes.

Invoices:
Invoices are generated on the first day of each month.
Invoices can be downloaded as PDF from Billing, then History.
Refund requests must include the invoice number.

Two-factor authentication:
Two-factor authentication can be enabled under Settings, then Security.
Supported second factors are authenticator apps and hardware security keys.

Unrelated release notes:
The dashboard color palette changed last quarter.
The marketing page headline was updated.
Our annual conference will be held in Lisbon this year.`;
    const MAX_CTX = 120, THRESH = 0.8, FALLBACK = "I could not find an answer in the provided context.";
    const STOP = new Set(`a about after all also an and any are as at be been but by could did do does for from had has have i if in into is it its just me my of on or our so than that the their them then there these they this to up was we were will with would you your`.split(/\s+/));
    const tok = (t) => (t.match(/\w+|[^\w\s]/g) || []).length;
    const norm = (t) => t.trim().toLowerCase().replace(/\s+/g, " ");
    const terms = (t) => (t.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w));
    const stem = (w) => { for (const s of ["ing", "ed", "es", "s"]) if (w.length > s.length + 2 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
    const vec = (t) => { const v = new Map(); for (const x of terms(t)) { const k = stem(x); v.set(k, (v.get(k) || 0) + 1); } return v; };
    const overlap = (a, b) => { let s = 0; for (const [k, n] of a) s += Math.min(n, b.get(k) || 0); return s; };
    const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (const [k, n] of a) { d += n * (b.get(k) || 0); na += n * n; } for (const n of b.values()) nb += n * n; return na && nb ? d / Math.sqrt(na * nb) : 0; };
    const sentences = (t) => t.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const dedupe = (t) => { const seen = new Set(); return t.split("\n").map((l) => l.trim()).filter((l) => { const k = l.toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join("\n"); };
    const select = (q, ctx) => {
      const qv = vec(q), ss = sentences(ctx).filter((s) => !s.endsWith(":")), sc = ss.map((s) => overlap(vec(s), qv));
      const ranked = ss.map((_, i) => i).sort((a, b) => sc[b] - sc[a]); const chosen = new Set(); let used = 0;
      for (const i of ranked) { if (sc[i] <= 0 && chosen.size) break; const t = tok(ss[i]); if (used + t > MAX_CTX) continue; chosen.add(i); used += t; }
      return [...chosen].sort((a, b) => a - b).map((i) => ss[i]).join("\n");
    };
    const optimize = (q) => {
      const original = `Context:\n${CONTEXT}\n\nQuestion: ${q.trim()}`;
      const compressed = `Answer the question using only the relevant context.\n\nRelevant context:\n${select(q, dedupe(CONTEXT))}\n\nQuestion: ${q.trim()}`;
      return { original, optimized: tok(compressed) < tok(original) ? compressed : original };
    };
    const model = (prompt, q) => {
      const qv = vec(q); let best = FALLBACK, bs = 0;
      for (const s of sentences(prompt.split("Question:")[0])) { if (s.endsWith(":") || s.startsWith("Answer the question")) continue; const sc = overlap(vec(s), qv); if (sc > bs) { best = s; bs = sc; } }
      return best;
    };
    class GW {
      constructor() { this.reset(); }
      reset() { this.exact = new Map(); this.sem = []; this.totals = { requests: 0, before: 0, after: 0 }; }
      complete(q) {
        const t0 = performance.now(), { original, optimized } = optimize(q), before = tok(original);
        let answer, cache = "miss", sim = null, matched = null; const key = norm(optimized);
        if (this.exact.has(key)) { answer = this.exact.get(key); cache = "exact"; }
        else {
          const qv = vec(q); let best = null;
          for (const e of this.sem) { const s = cosine(qv, e.vec); if (s >= THRESH && (!best || s > best.sim)) best = { ...e, sim: s }; }
          if (best) { answer = best.answer; cache = "semantic"; sim = best.sim; matched = best.q; }
        }
        if (!answer) { answer = model(optimized, q); this.exact.set(key, answer); this.sem.push({ q, answer, vec: vec(q) }); }
        const after = cache === "miss" ? tok(optimized) : 0;
        this.totals.requests++; this.totals.before += before; this.totals.after += after;
        return { answer, cache, sim, matched, before, after, ms: performance.now() - t0 };
      }
    }
    return { GW, CONTEXT };
  })();

  function mountGateway(root) {
    root.innerHTML = `
      <div class="demo">
        <div class="demo-head"><span class="label">Live · send requests through the gateway</span><button class="link-btn" type="button" data-act="reset">Reset caches</button></div>
        <div class="presets">
          ${["How do I reset my password?", "How can I reset my password?", "When are invoices generated?", "Where are invoices generated?"].map((q) => `<button class="preset" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("")}
        </div>
        <form class="ask"><label class="sr-only" for="gw-in">Question</label><input id="gw-in" value="How do I reset my password?" autocomplete="off"><button class="btn btn-signal btn-sm" type="submit">Send</button></form>
        <ol class="pipeline"><li>Optimize</li><li>Exact cache</li><li>Semantic cache</li><li>LLM</li></ol>
        <div class="result" aria-live="polite"><p class="fine">Send a question, send it again, then a reworded version, and watch which stage answers. The last example shares almost every word with the one before it, but <em>where</em> isn't <em>when</em>, so the gateway refuses to reuse that answer.</p></div>
        <dl class="totals"><div><dt>Requests</dt><dd data-t="req">0</dd></div><div><dt>Tokens, no gateway</dt><dd data-t="before">0</dd></div><div><dt>Tokens sent</dt><dd data-t="after">0</dd></div><div><dt>Saved</dt><dd data-t="saved">0%</dd></div></dl>
        <details class="more"><summary>Show the support docs sent as context</summary><pre class="fine context-pre">${esc(Gateway.CONTEXT)}</pre></details>
      </div>`;
    const gw = new Gateway.GW(), stages = $$(".pipeline li", root), out = $(".result", root), input = $("#gw-in", root);
    let busy = false;
    const T = (k) => $(`[data-t="${k}"]`, root);
    const paint = (r, step) => {
      const stop = { exact: 1, semantic: 2, miss: 3 }[r.cache];
      stages.forEach((li, i) => { li.className = ""; if (i < step) li.classList.add(i === stop ? "active" : "pass"); if (i === step && i <= stop) li.classList.add("active"); if (step > stop && i > stop) li.classList.add("skipped"); });
    };
    const render = (r) => {
      const saved = r.before ? Math.round((1 - r.after / r.before) * 100) : 0;
      const label = { miss: "Cache miss · sent to LLM", exact: "Exact cache hit", semantic: "Semantic cache hit" }[r.cache];
      out.innerHTML = `<span class="badge ${r.cache === "miss" ? "miss" : "ok"}">${label}</span><p class="answer">${esc(r.answer)}</p>
        <p class="facts-line"><span>tokens ${r.before} → ${r.after}</span><span>saved ${saved}%</span><span>gateway ${r.ms.toFixed(2)} ms</span>${r.cache === "semantic" ? `<span>matched “${esc(r.matched)}” · sim ${r.sim.toFixed(2)}</span>` : ""}</p>`;
      const t = gw.totals;
      T("req").textContent = t.requests; T("before").textContent = t.before.toLocaleString(); T("after").textContent = t.after.toLocaleString();
      T("saved").textContent = t.before ? `${((1 - t.after / t.before) * 100).toFixed(1)}%` : "0%";
    };
    const send = (q) => {
      q = q.trim(); if (!q || busy) return;
      const r = gw.complete(q), stop = { exact: 1, semantic: 2, miss: 3 }[r.cache];
      if (reduced) { paint(r, stop + 1); render(r); return; }
      busy = true; let step = 0;
      const tick = () => { paint(r, step); if (step > stop) { render(r); busy = false; return; } step++; setTimeout(tick, 240); };
      tick();
    };
    $("form", root).addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
    $$("[data-q]", root).forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.q; send(b.dataset.q); }));
    $('[data-act="reset"]', root).addEventListener("click", () => {
      gw.reset(); stages.forEach((li) => (li.className = ""));
      out.innerHTML = '<p class="fine">Caches cleared. Send a question to start again.</p>';
      T("req").textContent = T("before").textContent = T("after").textContent = "0"; T("saved").textContent = "0%";
    });
  }

  /* =========================================================
     SQL guard demo (port of nl-to-sql-agent's guard)
     ========================================================= */
  const Guard = (() => {
    const TABLES = new Set(["customers", "orders", "order_items", "products"]);
    const FORBIDDEN = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "COPY", "ATTACH", "DETACH", "PRAGMA", "SET", "INSTALL", "LOAD", "EXPORT", "IMPORT", "CALL", "TRUNCATE", "GRANT", "VACUUM"];
    const DENIED_FN = /\b(read_\w+|getenv|query|query_table|glob|current_setting|duckdb_\w+)\s*\(/i;
    const CATALOGS = /\b(information_schema|pg_catalog|sqlite_master)\b/i;
    const mask = (sql) => sql
      .replace(/--[^\n]*/g, (m) => " ".repeat(m.length))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
      .replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(Math.max(m.length - 2, 0)) + "'")
      .replace(/"(?:[^"]|"")*"/g, (m) => '"' + " ".repeat(Math.max(m.length - 2, 0)) + '"');
    function check(sql) {
      const m = mask(sql), stmts = m.split(";").filter((s) => s.trim());
      if (!stmts.length) return { verdict: "invalid", reasons: ["Empty query."] };
      const reasons = [];
      if (stmts.length > 1) reasons.push(`Found ${stmts.length} statements. Exactly one is allowed.`);
      const first = stmts[0].trim().split(/\s+/)[0].toUpperCase();
      if (!["SELECT", "WITH"].includes(first)) reasons.push(`Statement starts with <code>${esc(first)}</code>. Only SELECT / WITH queries are allowed.`);
      const found = FORBIDDEN.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(m));
      if (found.length) reasons.push(`Disallowed operation: <code>${found.join("</code>, <code>")}</code>.`);
      const fn = m.match(DENIED_FN); if (fn) reasons.push(`Function <code>${esc(fn[1])}()</code> can read files, the environment, or settings.`);
      const cat = m.match(CATALOGS); if (cat) reasons.push(`System catalog <code>${esc(cat[1])}</code> is off-limits.`);
      if (reasons.length) return { verdict: "blocked", reasons };
      const unknown = [];
      for (const x of m.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)/gi)) { const n = x[1].toLowerCase(); if (!TABLES.has(n)) unknown.push(n); }
      if (unknown.length) return { verdict: "invalid", reasons: [`Table <code>${esc(unknown[0])}</code> does not exist. Known tables: ${[...TABLES].join(", ")}. The agent sends this error back to the model to repair.`] };
      const hasLimit = /\blimit\s+\d+/i.test(m);
      return { verdict: "allowed", rendered: sql.trim().replace(/;\s*$/, "") + (hasLimit ? "" : " LIMIT 1000") };
    }
    return { check };
  })();

  function mountGuard(root) {
    const presets = [
      ["Safe SELECT", "SELECT name, city FROM customers ORDER BY name"],
      ["Stacked DROP", "SELECT name FROM customers; DROP TABLE customers"],
      ["Read a file", "SELECT * FROM read_csv('/etc/passwd')"],
      ["DROP inside a string", "SELECT name FROM customers WHERE city = '; DROP TABLE x'"],
      ["Catalog probe", "SELECT table_name FROM information_schema.tables"],
      ["Unknown table", "SELECT * FROM invoices"],
    ];
    root.innerHTML = `
      <div class="demo">
        <div class="demo-head"><span class="label">Live · can this SQL get past the guard?</span></div>
        <div class="presets">${presets.map(([l, s]) => `<button class="preset" type="button" data-sql="${esc(s)}">${esc(l)}</button>`).join("")}</div>
        <label class="sr-only" for="guard-in">SQL</label>
        <textarea id="guard-in" rows="3" spellcheck="false">${esc(presets[1][1])}</textarea>
        <div class="result" aria-live="polite"></div>
        <p class="fine">Simplified for the browser. The real guard parses a full <code>sqlglot</code> AST, checks every table and column against the schema, and runs the re-rendered SQL on a read-only DuckDB connection.</p>
      </div>`;
    const input = $("#guard-in", root), out = $(".result", root);
    const render = () => {
      const r = Guard.check(input.value);
      out.innerHTML = r.verdict === "allowed"
        ? `<span class="badge ok">Allowed</span><p class="answer muted">Runs read-only with external access off, a timeout, and a row cap:</p><p class="answer"><code>${esc(r.rendered)}</code></p>`
        : `<span class="badge ${r.verdict === "blocked" ? "bad" : "miss"}">${r.verdict === "blocked" ? "Blocked · fail closed" : "Invalid · sent back for repair"}</span><ul>${r.reasons.map((x) => `<li>${x}</li>`).join("")}</ul>`;
    };
    let t; input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(render, 140); });
    $$("[data-sql]", root).forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.sql; render(); }));
    render();
  }

  /* =========================================================
     Projects
     ========================================================= */
  const PROJECTS = [
    {
      id: "gateway", kind: ["demo", "oss"], vis: "flow",
      kicker: "LLM infrastructure · Python · FastAPI",
      title: "LLM Token Optimization Gateway",
      blurb: "A gateway between apps and any LLM. Trims irrelevant context, answers repeat and reworded questions from cache, and reports tokens saved per request.",
      stat: "<b>−91.7%</b> prompt tokens · <b>&lt;1 ms</b> p95 overhead",
      stats: [["91.7%", "fewer prompt tokens"], ["100%", "answer facts kept"], ["0", "false semantic matches"], ["<1 ms", "p95 overhead"]],
      points: ["Exact cache plus a semantic cache with a similarity threshold tuned to avoid false matches.", "LRU + TTL eviction; OpenAI-compatible API so apps switch with a base-URL change.", "Prometheus metrics, Docker image, and CI on every push."],
      code: "https://github.com/vipati/llm-token-optimization-gateway", demo: mountGateway,
    },
    {
      id: "sql", kind: ["demo", "oss"], vis: "tree",
      kicker: "AI agents · Python · DuckDB · sqlglot",
      title: "NL-to-SQL Agent",
      blurb: "Ask a database questions in plain English without letting an LLM run arbitrary SQL. Two independent safety layers and a self-correcting repair loop.",
      stat: "<b>30/30</b> unsafe queries blocked · <b>68%</b> exec accuracy",
      stats: [["68%", "execution accuracy (llama3.1:8b)"], ["100%", "valid SQL after repair"], ["30/30", "unsafe queries blocked"], ["10/10", "safe queries allowed"]],
      points: ["AST-based guard plus a locked-down read-only engine: either one alone stops a destructive query.", "Tries a deterministic fix before spending another model call.", "Execution-accuracy eval harness; FastAPI service and Streamlit UI on Ollama."],
      code: "https://github.com/vipati/nl-to-sql-agent", demo: mountGuard,
    },
    {
      id: "whisperoom", kind: ["oss"], vis: "wave",
      kicker: "Local AI · Voice",
      title: "Whisperoom",
      blurb: "A fully local voice mock-interview system. An LLM interviewer asks follow-ups and gives structured feedback, with nothing leaving your machine.",
      stat: "<b>0</b> paid APIs · behavioral, technical, system design",
      points: ["Speech-to-text with faster-whisper, replies spoken with Piper TTS.", "Interviewer and feedback run on Ollama after a one-time model download.", "Covers behavioral, technical, and system design rounds."],
      code: "https://github.com/vipati/whisperoom",
    },
    {
      id: "debug", kind: ["work"], vis: "grid",
      kicker: "At Microsoft · Security · Dev infra",
      title: "Secure production debugging",
      blurb: "Lets engineers debug live issues without exposing source maps publicly, built on Edge security features and adopted across five Office apps.",
      stat: "<b>−50%</b> SLA response · <b>5</b> Office apps",
      points: ["Adopted across Word, Excel, PowerPoint, OneNote, and Visio on the web.", "Helped mitigate high-severity security incidents faster.", "Source maps never leave a trusted boundary."],
    },
    {
      id: "copilot", kind: ["work"], vis: "nodes",
      kicker: "At Microsoft · RAG · Internal tooling",
      title: "AI troubleshooting copilot",
      blurb: "An internal assistant that pulls from engineering knowledge sources with access-aware retrieval, so engineers reach root causes of recurring issues faster.",
      stat: "Retrieval with <b>access-aware</b> controls",
      points: ["Retrieval workflows respect who is allowed to see which source.", "Built for recurring production investigations, alongside existing telemetry.", "Internal tool; no public code."],
    },
    {
      id: "track", kind: ["work"], vis: "lines",
      kicker: "At Microsoft · Architecture · Migration",
      title: "Track Changes for Word Online",
      blurb: "Led the architecture and rollout that moved Track Changes off legacy systems, coordinating engineering and product teams through the migration.",
      stat: "Led architecture across <b>eng + product</b>",
      points: ["Migration off legacy systems without disrupting users mid-document.", "Coordinated rollout across engineering and product teams.", "Part of the Office for the web platform work."],
    },
  ];

  const gallery = $("#gallery");
  gallery.innerHTML = PROJECTS.map((p) => `
    <article class="card" data-kind="${p.kind.join(" ")}" id="p-${p.id}">
      <div class="card-vis">${p.demo ? '<span class="live">Live demo</span>' : ""}<canvas data-vis="${p.vis}" aria-hidden="true"></canvas></div>
      <div class="card-body">
        <p class="label">${esc(p.kicker)}</p>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.blurb)}</p>
        <p class="card-stat">${p.stat}</p>
        <div class="card-actions">
          ${p.demo ? `<button class="btn btn-signal btn-sm" type="button" data-open="${p.id}">Try live demo</button>` : `<button class="btn btn-sm" type="button" data-open="${p.id}">Details</button>`}
          ${p.code ? `<a class="btn btn-sm" href="${p.code}" target="_blank" rel="noopener">Code <span class="arrow">↗</span></a>` : ""}
        </div>
      </div>
    </article>`).join("");

  // filters
  const filters = $$(".filter");
  filters.forEach((f) => { const k = f.dataset.filter; $(".n", f).textContent = k === "all" ? PROJECTS.length : PROJECTS.filter((p) => p.kind.includes(k)).length; });
  filters.forEach((f) => f.addEventListener("click", () => {
    filters.forEach((x) => x.setAttribute("aria-pressed", String(x === f)));
    const k = f.dataset.filter;
    $$(".card", gallery).forEach((c) => (c.hidden = k !== "all" && !c.dataset.kind.split(" ").includes(k)));
  }));

  // sheet
  const sheet = $("#sheet");
  function openProject(id) {
    const p = PROJECTS.find((x) => x.id === id); if (!p) return;
    $("#sheet-kicker").textContent = p.kicker;
    $("#sheet-title").textContent = p.title;
    const body = $("#sheet-body");
    body.innerHTML = `
      <p>${esc(p.blurb)}</p>
      ${p.stats ? `<ul class="stat-row">${p.stats.map(([n, l]) => `<li><strong>${esc(n)}</strong><span>${esc(l)}</span></li>`).join("")}</ul>` : ""}
      <div data-demo></div>
      <ul class="bullets">${p.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${p.code ? `<div><a class="btn btn-sm" href="${p.code}" target="_blank" rel="noopener">View code on GitHub <span class="arrow">↗</span></a></div>` : ""}`;
    if (p.demo) p.demo($("[data-demo]", body)); else $("[data-demo]", body).remove();
    if (typeof sheet.showModal === "function") sheet.showModal(); else sheet.setAttribute("open", "");
    body.scrollTop = 0;
  }
  const closeSheet = () => (sheet.close ? sheet.close() : sheet.removeAttribute("open"));
  gallery.addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openProject(b.dataset.open); });
  $("#sheet-close").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  // card visuals: small generative drawings, one motif per project
  const css = getComputedStyle(document.documentElement);
  const C = { signal: css.getPropertyValue("--signal").trim(), steel: css.getPropertyValue("--steel").trim(), line: css.getPropertyValue("--line-strong").trim(), faint: css.getPropertyValue("--faint").trim() };
  function draw(cv, t) {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const kind = cv.dataset.vis;
    g.lineWidth = 1;
    if (kind === "flow") { // four pipeline stages with packets flowing
      const xs = [0.14, 0.38, 0.62, 0.86].map((f) => f * w), y = h * 0.58;
      g.strokeStyle = C.line; g.beginPath(); g.moveTo(xs[0], y); g.lineTo(xs[3], y); g.stroke();
      xs.forEach((x, i) => { g.fillStyle = i === 3 ? C.faint : C.steel; g.fillRect(x - 4, y - 4, 8, 8); });
      for (let i = 0; i < 6; i++) { const p = ((t / 2600) + i / 6) % 1; const x = xs[0] + p * (xs[3] - xs[0]); const stop = i % 3 === 0 ? xs[3] : xs[1 + (i % 2)]; if (x > stop) continue; g.fillStyle = C.signal; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
    } else if (kind === "tree") { // an AST with one pruned branch
      const nodes = [[0.5, 0.25], [0.3, 0.5], [0.7, 0.5], [0.2, 0.78], [0.4, 0.78], [0.62, 0.78], [0.8, 0.78]];
      const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]];
      const pulse = (Math.sin(t / 500) + 1) / 2;
      edges.forEach(([a, b]) => { g.strokeStyle = b === 6 ? C.signal : C.line; g.globalAlpha = b === 6 ? 0.4 + pulse * 0.6 : 1; g.setLineDash(b === 6 ? [3, 3] : []); g.beginPath(); g.moveTo(nodes[a][0] * w, nodes[a][1] * h); g.lineTo(nodes[b][0] * w, nodes[b][1] * h); g.stroke(); });
      g.setLineDash([]); g.globalAlpha = 1;
      nodes.forEach(([x, y], i) => { g.fillStyle = i === 6 ? C.signal : C.steel; g.beginPath(); g.arc(x * w, y * h, i === 6 ? 4 : 3, 0, 7); g.fill(); });
    } else if (kind === "wave") { // voice waveform
      const n = Math.floor(w / 6);
      for (let i = 0; i < n; i++) { const x = i * 6 + 3, a = Math.abs(Math.sin(i * 0.37 + t / 400) * Math.sin(i * 0.11 + t / 900)) * h * 0.32 + 2; g.fillStyle = i % 9 === 0 ? C.signal : C.line; g.fillRect(x, h / 2 - a, 2, a * 2); }
    } else if (kind === "grid") { // five apps, one highlighted shield
      const cols = 5, cw = w / (cols + 1);
      for (let i = 0; i < cols; i++) { const x = cw * (i + 1), on = Math.floor(t / 900) % cols === i; g.strokeStyle = on ? C.signal : C.line; g.strokeRect(x - 14, h / 2 - 18, 28, 36); g.fillStyle = on ? C.signal : C.faint; g.fillRect(x - 6, h / 2 - 2, 12, 4); }
    } else if (kind === "nodes") { // retrieval graph
      const pts = [...Array(14)].map((_, i) => [((i * 0.618) % 1) * 0.8 + 0.1, ((i * 0.382 + 0.2) % 1) * 0.7 + 0.15]);
      const c = [0.5, 0.5], active = Math.floor(t / 700) % pts.length;
      pts.forEach(([x, y], i) => { g.strokeStyle = i === active ? C.signal : C.line; g.beginPath(); g.moveTo(c[0] * w, c[1] * h); g.lineTo(x * w, y * h); g.stroke(); g.fillStyle = i === active ? C.signal : C.faint; g.beginPath(); g.arc(x * w, y * h, 2.5, 0, 7); g.fill(); });
      g.fillStyle = C.steel; g.beginPath(); g.arc(c[0] * w, c[1] * h, 5, 0, 7); g.fill();
    } else if (kind === "lines") { // document with tracked insertions
      for (let i = 0; i < 6; i++) { const y = 24 + i * 17, len = (0.55 + ((i * 37) % 30) / 100) * (w - 48); g.fillStyle = C.line; g.fillRect(24, y, len, 3); if (i === 1 || i === 4) { const k = ((t / 1800) + i * 0.3) % 1; g.fillStyle = C.signal; g.fillRect(24 + len * 0.35, y, len * 0.3 * Math.min(1, k * 1.6), 3); } }
    }
  }
  const canvases = $$("canvas[data-vis]");
  const visible = new Set();
  const vo = new IntersectionObserver((ents) => ents.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target))));
  canvases.forEach((c) => vo.observe(c));
  const loop = (t) => { visible.forEach((c) => draw(c, t)); requestAnimationFrame(loop); };
  canvases.forEach((c) => draw(c, 1200));
  if (!reduced) requestAnimationFrame(loop);
  addEventListener("resize", () => canvases.forEach((c) => draw(c, 1200)));

  /* =========================================================
     Terminal
     ========================================================= */
  const body = $("#term-body"), out = $("#term-out"), tin = $("#term-in");
  const kv = (k, v, cls = "t-ok") => `<span class="t-k">${esc(k.padEnd(22))}</span><span class="${cls}">${esc(v)}</span>`;
  const CMDS = {
    help: () => [
      `<span class="t-dim">available commands</span>`,
      kv("whoami", "who I am", "t-cmd"), kv("impact", "headline results", "t-cmd"), kv("stack", "languages and tools", "t-cmd"),
      kv("projects", "list projects", "t-cmd"), kv("demo gateway | sql", "open a live demo", "t-cmd"),
      kv("experience", "jump to the timeline", "t-cmd"), kv("contact", "how to reach me", "t-cmd"), kv("clear", "clear the screen", "t-cmd"),
    ],
    whoami: () => [`vivek-patil <span class="t-dim">·</span> backend <span class="t-dim">·</span> platform <span class="t-dim">·</span> ai-infra`, `<span class="t-dim">12+ yrs · Microsoft (Office for the web) · Seattle, WA</span>`],
    impact: () => [
      kv("services_scale", "millions of users / hour"), kv("visually_ready_time", "-50%"), kv("release_cycle", "4 weeks → 4 days"),
      kv("sla_response_time", "-50%  (5 Office apps)"), kv("llm_prompt_tokens", "-91.7%  (benchmark)"), kv("unsafe_sql_blocked", "30 / 30"),
    ],
    stack: () => [kv("languages", "C# .NET Python TypeScript Java SQL", "t-cmd"), kv("cloud", "Azure Kusto Kubernetes Docker", "t-cmd"), kv("ci/cd", "Azure DevOps · GitHub Actions", "t-cmd"), kv("ai", "LLM gateways · RAG · agents · evals", "t-cmd")],
    projects: () => [...PROJECTS.map((p) => kv(p.id, p.title + (p.demo ? "  [live]" : ""), p.demo ? "t-ok" : "t-cmd")), `<span class="t-dim">run: demo gateway  or  demo sql</span>`],
    demo: (arg) => {
      const id = { gateway: "gateway", sql: "sql", guard: "sql" }[arg];
      if (!id) return [`<span class="t-bad">usage: demo gateway | demo sql</span>`];
      setTimeout(() => openProject(id), 250);
      return [`<span class="t-dim">opening ${esc(PROJECTS.find((p) => p.id === id).title)}…</span>`];
    },
    experience: () => { setTimeout(() => $("#experience").scrollIntoView(), 200); return [`<span class="t-dim">scrolling to /experience…</span>`]; },
    contact: () => [kv("email", "vivekpatilusc@gmail.com", "t-cmd"), kv("linkedin", "in/vivekanilpatil", "t-cmd"), kv("github", "vipati", "t-cmd"), `<span class="t-dim">or use the form at the bottom of the page</span>`],
    ls: () => [`<span class="t-k">about/  skills/  projects/  experience/  contact/</span>  impact.log  resume.pdf`],
    sudo: (arg) => [arg.startsWith("hire") ? `<span class="t-ok">permission granted.</span> <span class="t-dim">run: contact</span>` : `<span class="t-bad">vivek is not in the sudoers file. This incident will be reported.</span>`],
    clear: () => { out.innerHTML = ""; return []; },
  };
  const print = (html) => { out.insertAdjacentHTML("beforeend", html + "\n"); body.scrollTop = body.scrollHeight; };
  const run = (raw) => {
    const line = raw.trim(); print(`<span class="t-p">$</span> <span class="t-cmd">${esc(line)}</span>`);
    if (!line) return;
    const [cmd, ...rest] = line.split(/\s+/), fn = CMDS[cmd.toLowerCase()];
    const res = fn ? fn(rest.join(" ").toLowerCase()) : [`<span class="t-bad">command not found: ${esc(cmd)}</span> <span class="t-dim">· try help</span>`];
    res.forEach(print);
  };
  const history = []; let hi = 0;
  $("#term-form").addEventListener("submit", (e) => { e.preventDefault(); const v = tin.value; if (v.trim()) { history.push(v); hi = history.length; } run(v); tin.value = ""; });
  tin.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && hi > 0) { hi--; tin.value = history[hi]; e.preventDefault(); }
    else if (e.key === "ArrowDown") { hi = Math.min(history.length, hi + 1); tin.value = history[hi] || ""; e.preventDefault(); }
    else if (e.key === "Tab") { const m = Object.keys(CMDS).find((k) => k.startsWith(tin.value.trim())); if (m && tin.value.trim()) { tin.value = m + " "; e.preventDefault(); } }
  });
  body.addEventListener("click", () => { if (!getSelection().toString()) tin.focus({ preventScroll: true }); });
  $$(".term-hint [data-cmd]").forEach((b) => b.addEventListener("click", () => { run(b.dataset.cmd); tin.focus({ preventScroll: true }); }));

  // boot sequence: type two commands, then hand over to the visitor
  const script = ["whoami", "impact"];
  if (reduced) { script.forEach(run); print(`<span class="t-dim">type help to see what else this terminal does</span>`); }
  else {
    let si = 0;
    const typeCmd = () => {
      if (si >= script.length) { print(`<span class="t-dim">type help to see what else this terminal does</span>`); return; }
      const cmd = script[si++]; let ci = 0;
      const pending = document.createElement("span"); out.appendChild(pending);
      const step = () => {
        ci++; pending.innerHTML = `<span class="t-p">$</span> <span class="t-cmd">${esc(cmd.slice(0, ci))}</span><span class="cursor"></span>`;
        if (ci < cmd.length) return setTimeout(step, 55 + Math.random() * 40);
        setTimeout(() => {
          pending.remove(); const [c] = cmd.split(" ");
          print(`<span class="t-p">$</span> <span class="t-cmd">${esc(cmd)}</span>`);
          const lines = CMDS[c]("");
          lines.forEach((l, i) => setTimeout(() => print(l), 70 * (i + 1)));
          setTimeout(typeCmd, 70 * lines.length + 450);
        }, 260);
      };
      step();
    };
    setTimeout(typeCmd, 500);
  }

  /* =========================================================
     Contact form
     ========================================================= */
  const form = $("#contact-form"), msg = $("#cf-msg"), count = $("#cf-count");
  msg.addEventListener("input", () => (count.textContent = `${msg.value.length} / 2000`));
  const rules = {
    "cf-name": (v) => (v.trim().length >= 2 ? "" : "Enter your name."),
    "cf-email": (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Enter an email address like name@company.com."),
    "cf-msg": (v) => (v.trim().length >= 20 ? "" : "Write at least 20 characters so I know how to help."),
  };
  const validate = (id) => {
    const el = $("#" + id), err = rules[id](el.value), field = el.closest(".field");
    $("#" + id + "-err").textContent = err;
    err ? field.setAttribute("data-invalid", "") : field.removeAttribute("data-invalid");
    el.setAttribute("aria-invalid", err ? "true" : "false");
    return !err;
  };
  Object.keys(rules).forEach((id) => {
    const el = $("#" + id);
    el.setAttribute("aria-describedby", id + "-err");
    el.addEventListener("blur", () => el.value && validate(id));
    el.addEventListener("input", () => el.closest(".field").hasAttribute("data-invalid") && validate(id));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = Object.keys(rules).map(validate).every(Boolean);
    if (!ok) { $("[data-invalid] input, [data-invalid] textarea", form)?.focus(); return; }
    if ($("#cf-company").value) return; // honeypot
    const data = { name: $("#cf-name").value.trim(), email: $("#cf-email").value.trim(), topic: $("#cf-topic").value, message: msg.value.trim() };
    const btn = $("#cf-submit");

    if (FORM_ENDPOINT) {
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        const res = await fetch(FORM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ...data, _subject: `Portfolio: ${data.topic}` }) });
        if (!res.ok) throw new Error(String(res.status));
        $("#form-wrap").innerHTML = `<div class="form-status ok" role="status"><span class="badge ok">Message sent</span><p>Thanks, ${esc(data.name)}. I'll reply to ${esc(data.email)} within two working days.</p></div>`;
        return;
      } catch {
        btn.disabled = false; btn.innerHTML = 'Send message <span class="arrow">→</span>';
        showToast("Couldn't send. Copy the draft below and email me instead.");
      }
    }

    // No delivery service connected (or it failed): give the visitor a ready-to-send draft.
    const draft = `To: vivekpatilusc@gmail.com\nSubject: ${data.topic}\n\nHi Vivek,\n\n${data.message}\n\n${data.name}\n${data.email}`;
    const mailto = `mailto:vivekpatilusc@gmail.com?subject=${encodeURIComponent(data.topic)}&body=${encodeURIComponent(`Hi Vivek,\n\n${data.message}\n\n${data.name}`)}`;
    let panel = $("#draft-panel");
    if (!panel) { panel = document.createElement("div"); panel.id = "draft-panel"; panel.className = "form-status draft"; panel.setAttribute("role", "status"); form.after(panel); }
    panel.innerHTML = `<span class="badge miss">Not sent yet</span>
      <p>This page isn't connected to a mail service, so your message hasn't gone anywhere. Copy it and send it to <span class="mono">vivekpatilusc@gmail.com</span>.</p>
      <pre id="draft-text">${esc(draft)}</pre>
      <div class="socials"><button class="btn btn-signal btn-sm" type="button" id="copy-draft">Copy message</button><a class="btn btn-sm" href="${mailto}">Open in my email app</a></div>`;
    $("#copy-draft").addEventListener("click", () => copy(draft, "Message copied", $("#draft-text")));
  });

  $("#year").textContent = new Date().getFullYear();
})();
