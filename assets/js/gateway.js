// In-browser port of the LLM Token Optimization Gateway pipeline:
// optimize prompt -> exact cache -> semantic cache -> model.
// Mirrors the Python project (github.com/vipati/llm-token-optimization-gateway) closely enough
// to show the behaviour; the "model" is the same deterministic extractive stand-in.
(() => {
  "use strict";

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

  const MAX_CONTEXT_TOKENS = 120;
  const SEMANTIC_THRESHOLD = 0.8;
  const FALLBACK = "I could not find an answer in the provided context.";
  // Question words and negations are kept on purpose: "when" vs "where" changes the answer.
  const STOP = new Set(`a about after all also an and any are as at be been but by could did do does for from
    had has have i if in into is it its just me my of on or our so than that the their them
    then there these they this to up was we were will with would you your`.split(/\s+/));

  const countTokens = (text) => (text.match(/\w+|[^\w\s]/g) || []).length;
  const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, " ");
  const terms = (text) => (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w));
  const stem = (w) => {
    for (const s of ["ing", "ed", "es", "s"]) {
      if (w.length > s.length + 2 && w.endsWith(s)) return w.slice(0, -s.length);
    }
    return w;
  };
  const vector = (text) => {
    const v = new Map();
    for (const t of terms(text)) { const k = stem(t); v.set(k, (v.get(k) || 0) + 1); }
    return v;
  };
  const overlap = (a, b) => { let s = 0; for (const [k, n] of a) s += Math.min(n, b.get(k) || 0); return s; };
  const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (const [k, n] of a) { dot += n * (b.get(k) || 0); na += n * n; }
    for (const n of b.values()) nb += n * n;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  const splitSentences = (text) =>
    text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

  function dedupeLines(text) {
    const seen = new Set();
    return text.split("\n").map((l) => l.trim()).filter((l) => {
      const key = l.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join("\n");
  }

  function selectContext(question, context) {
    const qv = vector(question);
    const sentences = splitSentences(context).filter((s) => !s.endsWith(":"));
    const scores = sentences.map((s) => overlap(vector(s), qv));
    const ranked = sentences.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const chosen = new Set();
    let used = 0;
    for (const i of ranked) {
      if (scores[i] <= 0 && chosen.size) break;
      const t = countTokens(sentences[i]);
      if (used + t > MAX_CONTEXT_TOKENS) continue;
      chosen.add(i);
      used += t;
    }
    return [...chosen].sort((a, b) => a - b).map((i) => sentences[i]).join("\n");
  }

  function optimize(question, context) {
    const original = `Context:\n${context}\n\nQuestion: ${question.trim()}`;
    const compressed = `Answer the question using only the relevant context.\n\nRelevant context:\n${selectContext(question, dedupeLines(context))}\n\nQuestion: ${question.trim()}`;
    return { original, optimized: countTokens(compressed) < countTokens(original) ? compressed : original };
  }

  function mockModel(prompt, question) {
    const qv = vector(question);
    let best = FALLBACK, bestScore = 0;
    const body = prompt.split("Question:")[0];
    for (const s of splitSentences(body)) {
      if (s.endsWith(":") || s.startsWith("Answer the question")) continue;
      const score = overlap(vector(s), qv);
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return best;
  }

  class Gateway {
    constructor() { this.reset(); }
    reset() {
      this.exact = new Map();
      this.semantic = [];
      this.totals = { requests: 0, before: 0, after: 0 };
    }
    complete(question) {
      const started = performance.now();
      const { original, optimized } = optimize(question, CONTEXT);
      const before = countTokens(original);
      let answer, cache = "miss", similarity = null, matched = null;

      const key = normalize(optimized);
      if (this.exact.has(key)) {
        answer = this.exact.get(key); cache = "exact";
      } else {
        const qv = vector(question);
        let best = null;
        for (const e of this.semantic) {
          const sim = cosine(qv, e.vec);
          if (sim >= SEMANTIC_THRESHOLD && (!best || sim > best.sim)) best = { ...e, sim };
        }
        if (best) {
          answer = best.answer; cache = "semantic"; similarity = best.sim; matched = best.question;
        }
      }
      if (!answer) {
        answer = mockModel(optimized, question);
        this.exact.set(key, answer);
        this.semantic.push({ question, answer, vec: vector(question) });
      }
      const after = cache === "miss" ? countTokens(optimized) : 0;
      this.totals.requests += 1; this.totals.before += before; this.totals.after += after;
      return { answer, cache, similarity, matched, before, after, optimized, ms: performance.now() - started };
    }
  }

  // ---------- UI ----------
  const root = document.getElementById("gateway-demo");
  if (!root) return;
  const gateway = new Gateway();
  const $ = (id) => document.getElementById(id);
  const stages = [...root.querySelectorAll(".pipeline li")];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let busy = false;

  $("gw-context").textContent = CONTEXT;

  function paintStages(result, step) {
    const stop = { exact: 1, semantic: 2, miss: 3 }[result.cache];
    stages.forEach((li, i) => {
      li.className = "";
      if (i < step) li.classList.add(i === stop ? "active" : "pass");
      if (i === step && i <= stop) li.classList.add("active");
      if (step > stop && i > stop) li.classList.add("skipped");
    });
  }

  function render(result) {
    const saved = result.before ? Math.round((1 - result.after / result.before) * 100) : 0;
    const label = { miss: "Cache miss · sent to LLM", exact: "Exact cache hit", semantic: "Semantic cache hit" }[result.cache];
    const extra = result.cache === "semantic"
      ? `<span>matched “${escapeHtml(result.matched)}” · similarity ${result.similarity.toFixed(2)}</span>` : "";
    $("gw-result").innerHTML = `
      <span class="badge ${result.cache === "miss" ? "miss" : "hit"}">${label}</span>
      <p class="answer">${escapeHtml(result.answer)}</p>
      <p class="facts">
        <span>tokens ${result.before} → ${result.after}</span>
        <span>saved ${saved}%</span>
        <span>gateway ${result.ms.toFixed(2)} ms</span>
        ${extra}
      </p>`;
    const t = gateway.totals;
    $("gw-req").textContent = t.requests;
    $("gw-before").textContent = t.before.toLocaleString();
    $("gw-after").textContent = t.after.toLocaleString();
    $("gw-saved").textContent = t.before ? `${((1 - t.after / t.before) * 100).toFixed(1)}%` : "0%";
  }

  function send(question) {
    question = question.trim();
    if (!question || busy) return;
    const result = gateway.complete(question);
    const stop = { exact: 1, semantic: 2, miss: 3 }[result.cache];
    if (reduced) { paintStages(result, stop + 1); render(result); return; }
    busy = true;
    let step = 0;
    const tick = () => {
      paintStages(result, step);
      if (step > stop) { render(result); busy = false; return; }
      step += 1;
      setTimeout(tick, 260);
    };
    tick();
  }

  $("gw-form").addEventListener("submit", (e) => { e.preventDefault(); send($("gw-input").value); });
  root.querySelectorAll("[data-q]").forEach((btn) =>
    btn.addEventListener("click", () => { $("gw-input").value = btn.dataset.q; send(btn.dataset.q); }));
  $("gw-reset").addEventListener("click", () => {
    gateway.reset();
    stages.forEach((li) => (li.className = ""));
    $("gw-result").innerHTML = '<p class="muted">Caches cleared. Send a question to start again.</p>';
    ["gw-req", "gw-before", "gw-after"].forEach((id) => ($(id).textContent = "0"));
    $("gw-saved").textContent = "0%";
  });
})();
